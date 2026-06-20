import { query } from '../client.js';
import { generateEmbedding } from '../../ai/embeddings.js';
import { createLogger } from '../../logger.js';

const log = createLogger('kb-repo');

export interface KbEntry {
  id: string;
  source_type: string;
  source_id: string | null;
  chunk_index: number;
  content: string;
  metadata: Record<string, unknown>;
  created_at: Date;
}

// ---------------------------------------------------------------------------
// Save knowledge
// ---------------------------------------------------------------------------

/**
 * Save a knowledge entry with its embedding.
 * source_id groups chunks from the same document/teaching.
 */
export async function saveKnowledge(opts: {
  sourceId: string;
  content: string;
  chunkIndex?: number;
  metadata?: Record<string, unknown>;
}): Promise<KbEntry> {
  const embedding = await generateEmbedding(opts.content);
  const vectorStr = `[${embedding.join(',')}]`;

  const { rows } = await query<KbEntry>(
    `INSERT INTO embeddings (source_type, source_id, chunk_index, content, embedding, metadata)
     VALUES ('knowledge', $1, $2, $3, $4::vector, $5)
     RETURNING *`,
    [
      opts.sourceId,
      opts.chunkIndex ?? 0,
      opts.content,
      vectorStr,
      JSON.stringify(opts.metadata ?? {}),
    ],
  );
  return rows[0];
}

/**
 * Save a teaching (single rule/fact from /teach command).
 */
export async function saveTeaching(
  category: string,
  content: string,
  taughtBy: string,
): Promise<KbEntry> {
  const sourceId = `teach_${Date.now()}`;
  return saveKnowledge({
    sourceId,
    content: `[${category}] ${content}`,
    metadata: { category, taught_by: taughtBy, type: 'teaching' },
  });
}

/**
 * Save a document in chunks.
 * Splits long text into overlapping chunks for better retrieval.
 */
export async function saveDocument(
  sourceId: string,
  title: string,
  content: string,
  metadata?: Record<string, unknown>,
): Promise<number> {
  // Remove old chunks for this document (re-import)
  await query(
    `DELETE FROM embeddings WHERE source_type = 'knowledge' AND source_id = $1`,
    [sourceId],
  );

  const chunks = chunkText(content, 800, 100);
  let saved = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunkContent = `[${title}] ${chunks[i]}`;
    try {
      await saveKnowledge({
        sourceId,
        content: chunkContent,
        chunkIndex: i,
        metadata: { ...metadata, title, type: 'document', total_chunks: chunks.length },
      });
      saved++;
    } catch (err) {
      log.warn({ err, sourceId, chunk: i }, 'Failed to save knowledge chunk');
    }
  }

  log.info({ sourceId, title, chunks: saved }, 'Document saved to knowledge base');
  return saved;
}

// ---------------------------------------------------------------------------
// Search knowledge
// ---------------------------------------------------------------------------

/**
 * Search the knowledge base by semantic similarity.
 */
export async function searchKnowledge(
  queryText: string,
  limit = 5,
): Promise<{ content: string; metadata: Record<string, unknown>; score: number }[]> {
  const embedding = await generateEmbedding(queryText);
  const vectorStr = `[${embedding.join(',')}]`;

  const { rows } = await query<{
    content: string;
    metadata: Record<string, unknown>;
    distance: number;
  }>(
    `SELECT content, metadata, (embedding <=> $1::vector) AS distance
     FROM embeddings
     WHERE source_type = 'knowledge'
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [vectorStr, limit],
  );

  return rows.map((r) => ({
    content: r.content,
    metadata: r.metadata,
    score: 1 - r.distance, // Convert distance to similarity score
  }));
}

/**
 * List all knowledge sources (documents and teachings).
 */
export async function listKnowledgeSources(): Promise<{
  source_id: string;
  title: string;
  type: string;
  chunks: number;
  created_at: Date;
}[]> {
  const { rows } = await query<{
    source_id: string;
    title: string;
    type: string;
    chunks: number;
    created_at: Date;
  }>(
    `SELECT
       source_id,
       metadata->>'title' AS title,
       metadata->>'type' AS type,
       COUNT(*)::int AS chunks,
       MIN(created_at) AS created_at
     FROM embeddings
     WHERE source_type = 'knowledge'
     GROUP BY source_id, metadata->>'title', metadata->>'type'
     ORDER BY MIN(created_at) DESC`,
  );
  return rows;
}

/**
 * Delete a knowledge source and all its chunks.
 */
export async function deleteKnowledge(sourceId: string): Promise<number> {
  const { rowCount } = await query(
    `DELETE FROM embeddings WHERE source_type = 'knowledge' AND source_id = $1`,
    [sourceId],
  );
  return rowCount ?? 0;
}

// ---------------------------------------------------------------------------
// Text chunking
// ---------------------------------------------------------------------------

function chunkText(text: string, maxChars: number, overlap: number): string[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    if (current.length + trimmed.length + 2 > maxChars && current.length > 0) {
      chunks.push(current.trim());
      // Keep overlap from end of current chunk
      const words = current.split(/\s+/);
      const overlapWords = words.slice(-Math.ceil(overlap / 5));
      current = overlapWords.join(' ') + '\n\n' + trimmed;
    } else {
      current += (current ? '\n\n' : '') + trimmed;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  // If no paragraphs found, chunk by character count
  if (chunks.length === 0 && text.trim()) {
    chunks.push(text.trim());
  }

  return chunks;
}
