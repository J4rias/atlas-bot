import { getBot } from './bot.js';
import { getBossRecipients, getTechRecipients } from './recipients.js';
import { createLogger } from '../../shared/logger.js';

const log = createLogger('manager').child({ module: 'notifications' });

/**
 * Convert standard Markdown bold (**text**) to Telegram Markdown bold (*text*).
 * GPT models default to **double asterisks**; Telegram expects *single*.
 */
export function toTelegramMarkdown(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '*$1*');
}

/** Send a message to all boss recipients (group or individual). */
export async function notifyBosses(text: string, parseMode?: 'Markdown' | 'HTML'): Promise<void> {
  const bot = getBot();
  if (!bot) {
    log.warn('Bot not initialized — cannot send notification');
    return;
  }

  const recipients = await getBossRecipients();
  for (const r of recipients) {
    try {
      await bot.api.sendMessage(r.chatId, text, parseMode ? { parse_mode: parseMode } : {});
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ chatId: r.chatId, name: r.name, err: msg }, 'Failed to notify boss');
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
