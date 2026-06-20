import { query } from '../client.js';
import { generateEmbedding, memoryToEmbeddingText } from '../../ai/embeddings.js';
import { createLogger } from '../../logger.js';

const log = createLogger('memory-repo');

export interface AgentMemory {
  id: string;
  category: string;
  subject: string;
  content: string;
  confidence: number;
  source: string | null;
  outcome: string | null;
  valid_until: Date | null;
  superseded_by: string | null;
  created_at: Date;
  updated_at: Date;
}

/** Find active memories by category and optional subject pattern. */
export async function findMemories(
  category?: string,
  subjectPattern?: string,
  limit = 20,
): Promise<AgentMemory[]> {
  const conditions: string[] = [
    'superseded_by IS NULL',
    '(valid_until IS NULL OR valid_until > NOW())',
  ];
  const params: unknown[] = [];

  if (category) {
    params.push(category);
    conditions.push(`category = $${params.length}`);
  }
  if (subjectPattern) {
    params.push(`%${subjectPattern}%`);
    conditions.push(`subject ILIKE $${params.length}`);
  }

  params.push(limit);

  const { rows } = await query<AgentMemory>(
    `SELECT * FROM agent_memory
     WHERE ${conditions.join(' AND ')}
     ORDER BY updated_at DESC
     LIMIT $${params.length}`,
    params,
  );
  return rows;
}

/** Save a new memory entry. */
export async function saveMemory(mem: {
  category: string;
  subject: string;
  content: string;
  confidence?: number;
  source?: string;
  valid_until?: Date;
}): Promise<AgentMemory> {
  const { rows } = await query<AgentMemory>(
    `INSERT INTO agent_memory (category, subject, content, confidence, source, valid_until)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [mem.category, mem.subject, mem.content, mem.confidence ?? 1.0, mem.source ?? null, mem.valid_until ?? null],
  );
  return rows[0];
}

/** Supersede an old memory with a new one. */
export async function supersedeMemory(
  oldId: string,
  newMem: { category: string; subject: string; content: string; confidence?: number; source?: string },
): Promise<AgentMemory> {
  const saved = await saveMemory(newMem);
  await query(
    'UPDATE agent_memory SET superseded_by = $1, updated_at = NOW() WHERE id = $2',
    [saved.id, oldId],
  );
  return saved;
}

/** Record the outcome of a decision or suggestion. */
export async function recordOutcome(id: string, outcome: string): Promise<void> {
  await query(
    'UPDATE agent_memory SET outcome = $1, updated_at = NOW() WHERE id = $2',
    [outcome, id],
  );
}

// ---------------------------------------------------------------------------
// Embedding-powered memory (RAG)
// ---------------------------------------------------------------------------

/** Save an embedding for a memory record. */
export async function saveMemoryEmbedding(memoryId: string, category: string, subject: string, content: string): Promise<void> {
  try {
    const text = memoryToEmbeddingText(category, subject, content);
    const embedding = await generateEmbedding(text);
    const vectorStr = `[${embedding.join(',')}]`;

    // Remove old embedding for this memory if exists
    await query(
      `DELETE FROM embeddings WHERE source_type = 'memory' AND source_id = $1`,
      [memoryId],
    );

    await query(
      `INSERT INTO embeddings (source_type, source_id, content, embedding, metadata)
       VALUES ('memory', $1, $2, $3::vector, $4)`,
      [memoryId, text, vectorStr, JSON.stringify({ category, subject })],
    );
  } catch (err) {
    log.warn({ err, memoryId }, 'Failed to save memory embedding — memory saved without vector');
  }
}

/** Search memories by semantic similarity to a query string. */
export async function searchMemoriesBySimilarity(
  queryText: string,
  limit = 5,
): Promise<AgentMemory[]> {
  const embedding = await generateEmbedding(queryText);
  const vectorStr = `[${embedding.join(',')}]`;

  const { rows } = await query<AgentMemory>(
    `SELECT m.*
     FROM agent_memory m
     JOIN embeddings e ON e.source_type = 'memory' AND e.source_id = m.id::text
     WHERE m.superseded_by IS NULL
       AND (m.valid_until IS NULL OR m.valid_until > NOW())
     ORDER BY e.embedding <=> $1::vector
     LIMIT $2`,
    [vectorStr, limit],
  );
  return rows;
}
