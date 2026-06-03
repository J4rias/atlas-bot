import type { Context, SessionFlavor } from 'grammy';

export interface SessionData {
  /** Tracks the last time this chat interacted with the agent. */
  lastInteraction?: number;
}

export type BotContext = Context & SessionFlavor<SessionData>;

export interface Recipient {
  chatId: string;
  name: string;
  role: 'boss' | 'tech';
  active: boolean;
}
