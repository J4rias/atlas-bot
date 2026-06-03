import type { NextFunction } from 'grammy';
import type { BotContext } from './types.js';
import { createLogger } from '../../shared/logger.js';
import { getRecipients } from './recipients.js';

const log = createLogger('manager').child({ module: 'auth' });

/**
 * Auth middleware: only allow messages from configured recipients.
 * Recipients are loaded from ERP config (or fallback to env var).
 */
export async function authMiddleware(ctx: BotContext, next: NextFunction) {
  const chatId = ctx.chat?.id?.toString();
  if (!chatId) return;

  const recipients = await getRecipients();
  const allowed = recipients.some((r) => r.chatId === chatId && r.active);

  if (!allowed) {
    log.warn({ chatId }, 'Unauthorized chat attempted access');
    await ctx.reply('No estás autorizado para interactuar con el Manager de Atlas.');
    return;
  }

  await next();
}
