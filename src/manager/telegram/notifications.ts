import { getBot } from './bot.js';
import { getBossRecipients, getTechRecipients } from './recipients.js';
import { createLogger } from '../../shared/logger.js';

const log = createLogger('manager').child({ module: 'notifications' });

const TG_MAX_LENGTH = 4096;

/** Split a long message into Telegram-safe chunks, breaking at newlines. */
function splitMessage(text: string): string[] {
  if (text.length <= TG_MAX_LENGTH) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= TG_MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }
    let cut = remaining.lastIndexOf('\n', TG_MAX_LENGTH);
    if (cut <= 0) cut = TG_MAX_LENGTH;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\n/, '');
  }
  return chunks;
}

/**
 * Convert standard Markdown bold (**text**) to Telegram Markdown bold (*text*).
 * GPT models default to **double asterisks**; Telegram expects *single*.
 */
export function toTelegramMarkdown(text: string): string {
  // Convert **bold** → *bold* (GPT/GLM style → Telegram)
  let result = text.replace(/\*\*(.+?)\*\*/g, '*$1*');
  // Strip leftover ** that didn't form pairs (e.g., unmatched "**text" without closing)
  result = result.replace(/\*\*/g, '');
  // Remove unpaired single * that break Telegram Markdown parsing
  // N asterisks → N+1 parts from split; odd N (unpaired) → even part count
  const parts = result.split('*');
  if (parts.length % 2 === 0) {
    const lastIdx = result.lastIndexOf('*');
    result = result.slice(0, lastIdx) + result.slice(lastIdx + 1);
  }
  return result;
}

/** Send a message to all boss recipients (group or individual). */
export async function notifyBosses(text: string, parseMode?: 'Markdown' | 'HTML'): Promise<void> {
  const bot = getBot();
  if (!bot) {
    log.warn('Bot not initialized — cannot send notification');
    return;
  }

  if (!text || !text.trim()) {
    log.warn('Empty text — skipping boss notification');
    return;
  }

  const chunks = splitMessage(text);
  const opts = parseMode ? { parse_mode: parseMode } as const : {};
  const recipients = await getBossRecipients();
  for (const r of recipients) {
    for (const chunk of chunks) {
      try {
        await bot.api.sendMessage(r.chatId, chunk, opts);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        // If Markdown fails, retry without parse mode
        if (parseMode && msg.includes("can't parse")) {
          log.warn({ chatId: r.chatId, name: r.name }, 'Markdown parse failed — retrying as plain text');
          try {
            await bot.api.sendMessage(r.chatId, chunk);
            continue; // retry succeeded, don't log error
          } catch { /* fall through to error log */ }
        }
        log.error({ chatId: r.chatId, name: r.name, err: msg }, 'Failed to notify boss');
      }
    }
  }
}

/** Send a technical escalation to tech recipients. */
export async function notifyTech(text: string, parseMode?: 'Markdown' | 'HTML'): Promise<void> {
  const bot = getBot();
  if (!bot) {
    log.warn('Bot not initialized — cannot send tech notification');
    return;
  }

  const recipients = await getTechRecipients();
  for (const r of recipients) {
    try {
      await bot.api.sendMessage(r.chatId, text, parseMode ? { parse_mode: parseMode } : {});
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ chatId: r.chatId, name: r.name, err: msg }, 'Failed to notify tech');
    }
  }
}
