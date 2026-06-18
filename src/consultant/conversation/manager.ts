import type Anthropic from '@anthropic-ai/sdk';
import type { SalesStage } from './stages.js';

// ---------------------------------------------------------------------------
// Customer profile (detected during conversation)
// ---------------------------------------------------------------------------

export type CustomerProfile = 'mayorista' | 'minorista' | 'indeciso' | 'unknown';

// ---------------------------------------------------------------------------
// Per-sender conversation state
// ---------------------------------------------------------------------------

export interface ConversationState {
  senderId: string;
  channel: string;
  stage: SalesStage;
  profile: CustomerProfile;
  messages: Anthropic.MessageParam[];
  startedAt: Date;
  lastMessageAt: Date;
}

// In-memory store. For MVP this is sufficient — conversations reset on restart.
// Phase 4+ can persist to DB via conversation.repo.ts.
const conversations = new Map<string, ConversationState>();

// Conversations expire after 30 minutes of inactivity
const EXPIRY_MS = 30 * 60_000;

/** Get or create a conversation for a sender. */
export function getConversation(senderId: string, channel: string): ConversationState {
  const existing = conversations.get(senderId);

  if (existing) {
    const elapsed = Date.now() - existing.lastMessageAt.getTime();
    if (elapsed < EXPIRY_MS) {
      existing.lastMessageAt = new Date();
      return existing;
    }
    // Expired — start fresh
    conversations.delete(senderId);
  }

  const state: ConversationState = {
    senderId,
    channel,
    stage: 'greeting',
    profile: 'unknown',
    messages: [],
    startedAt: new Date(),
    lastMessageAt: new Date(),
  };
  conversations.set(senderId, state);
  return state;
}

/** Add a user message to the conversation. */
export function addUserMessage(state: ConversationState, text: string) {
  state.messages.push({ role: 'user', content: text });
  state.lastMessageAt = new Date();

  // Keep last 40 messages to avoid context overflow
  if (state.messages.length > 40) {
    state.messages = state.messages.slice(-40);
  }
}

/** Add the assistant response to the conversation. */
export function addAssistantMessage(state: ConversationState, text: string) {
  state.messages.push({ role: 'assistant', content: text });
}

/** Update the detected sales stage. */
export function setStage(state: ConversationState, stage: SalesStage) {
  state.stage = stage;
}

/** Update the detected customer profile. */
export function setProfile(state: ConversationState, profile: CustomerProfile) {
  state.profile = profile;
}

/** How many active conversations are tracked. */
export function activeCount(): number {
  return conversations.size;
}
