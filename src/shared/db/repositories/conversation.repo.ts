import { query } from '../client.js';

export interface Conversation {
  id: string;
  mode: 'consultant' | 'manager';
  external_id: string | null;
  channel: string;
  started_at: Date;
  ended_at: Date | null;
  metadata: Record<string, unknown>;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  tool_use: unknown | null;
  tokens_in: number | null;
  tokens_out: number | null;
  created_at: Date;
}

/** Start a new conversation. */
export async function startConversation(data: {
  mode: 'consultant' | 'manager';
  external_id?: string;
  channel: string;
  metadata?: Record<string, unknown>;
}): Promise<Conversation> {
  const { rows } = await query<Conversation>(
    `INSERT INTO conversations (mode, external_id, channel, metadata)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [data.mode, data.external_id ?? null, data.channel, data.metadata ?? {}],
  );
  return rows[0];
}

/** Add a message to a conversation. */
export async function addMessage(msg: {
  conversation_id: string;
  role: string;
  content: string;
  tool_use?: unknown;
  tokens_in?: number;
  tokens_out?: number;
}): Promise<Message> {
  const { rows } = await query<Message>(
    `INSERT INTO messages (conversation_id, role, content, tool_use, tokens_in, tokens_out)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [msg.conversation_id, msg.role, msg.content, msg.tool_use ?? null, msg.tokens_in ?? null, msg.tokens_out ?? null],
  );
  return rows[0];
}

/** Get recent messages for a conversation. */
export async function getMessages(
  conversationId: string,
  limit = 50,
): Promise<Message[]> {
  const { rows } = await query<Message>(
    `SELECT * FROM messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC
     LIMIT $2`,
    [conversationId, limit],
  );
  return rows;
}

/** Find the latest open conversation for an external ID. */
export async function findOpenConversation(
  mode: 'consultant' | 'manager',
  externalId: string,
): Promise<Conversation | null> {
  const { rows } = await query<Conversation>(
    `SELECT * FROM conversations
     WHERE mode = $1 AND external_id = $2 AND ended_at IS NULL
     ORDER BY started_at DESC
     LIMIT 1`,
    [mode, externalId],
  );
  return rows[0] ?? null;
}
