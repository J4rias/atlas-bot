import { getOpenAIClient } from './client.js';
import { createLogger } from '../logger.js';

const log = createLogger('embeddings');

const EMBEDDING_MODEL = 'text-embedding-3-small';
const DIMENSIONS = 1024;

/**
 * Generate an embedding vector for the given text.
 * Returns a 1024-dimension float array compatible with pgvector.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const client = getOpenAIClient();
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
    dimensions: DIMENSIONS,
  });
  return response.data[0].embedding;
}

/**
 * Generate embeddings for multiple texts in a single API call.
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const client = getOpenAIClient();
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
    dimensions: DIMENSIONS,
  });
  return response.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

/**
 * Build embedding-friendly text from a memory record.
 */
export function memoryToEmbeddingText(category: string, subject: string, content: string): string {
  return `[${category}] ${subject}: ${content}`;
}
