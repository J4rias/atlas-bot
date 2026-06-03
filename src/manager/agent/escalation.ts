import { InlineKeyboard } from 'grammy';
import { getBot } from '../telegram/bot.js';
import { getBossRecipients, getTechRecipients } from '../telegram/recipients.js';
import { createLogger } from '../../shared/logger.js';

const log = createLogger('manager').child({ module: 'escalation' });

// ---------------------------------------------------------------------------
// Escalation to bosses (business decisions)
// ---------------------------------------------------------------------------

export interface SuggestionPayload {
  id: string;
  situation: string;
  analysis: string;
  options: string[];
  recommendation?: string;
}

/** Escalate a business decision to bosses with inline approval buttons. */
export async function escalateToBosses(payload: SuggestionPayload): Promise<void> {
  const bot = getBot();
  if (!bot) {
    log.warn('Bot not initialized — cannot escalate');
    return;
  }

  const text =
    `*CONSULTA DEL MANAGER*\n\n` +
    `*Situación:* ${payload.situation}\n\n` +
    `*Mi análisis:* ${payload.analysis}\n\n` +
    `*Opciones:*\n${payload.options.map((o, i) => `${i + 1}. ${o}`).join('\n')}` +
    (payload.recommendation ? `\n\n*Mi recomendación:* ${payload.recommendation}` : '') +
    `\n\nNecesito que decidan.`;

  const keyboard = new InlineKeyboard()
    .text('Aprobar', `approve:${payload.id}`)
    .text('Rechazar', `reject:${payload.id}`)
    .text('Modificar', `modify:${payload.id}`);

  const recipients = await getBossRecipients();
  for (const r of recipients) {
    try {
      await bot.api.sendMessage(r.chatId, text, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ chatId: r.chatId, err: msg }, 'Failed to escalate to boss');
    }
  }
}

// ---------------------------------------------------------------------------
// Escalation to tech (technical issues)
// ---------------------------------------------------------------------------

export interface TechEscalation {
  attempted: string;
  failed: string;
  needed: string;
  priority: 'ALTA' | 'MEDIA' | 'BAJA';
}

/** Escalate a technical issue to the tech team. */
export async function escalateToTech(payload: TechEscalation): Promise<void> {
  const bot = getBot();
  if (!bot) {
    log.warn('Bot not initialized — cannot escalate to tech');
    return;
  }

  const text =
    `*REPORTE TÉCNICO*\n\n` +
    `*Qué intenté:* ${payload.attempted}\n` +
    `*Qué falló:* ${payload.failed}\n` +
    `*Qué necesito:* ${payload.needed}\n` +
    `*Prioridad:* ${payload.priority}`;

  const recipients = await getTechRecipients();
  for (const r of recipients) {
    try {
      await bot.api.sendMessage(r.chatId, text, { parse_mode: 'Markdown' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ chatId: r.chatId, err: msg }, 'Failed to escalate to tech');
    }
  }
}

// ---------------------------------------------------------------------------
// Callback query handler for inline buttons
// ---------------------------------------------------------------------------

/** Register callback handlers on the bot for approval buttons. */
export function registerCallbackHandlers() {
  const bot = getBot();
  if (!bot) return;

  bot.callbackQuery(/^approve:(.+)$/, async (ctx) => {
    const suggestionId = ctx.match[1];
    log.info({ suggestionId, user: ctx.from.first_name }, 'Suggestion approved');
    await ctx.answerCallbackQuery({ text: 'Aprobado' });
    await ctx.editMessageText(
      ctx.callbackQuery.message?.text + `\n\n*Aprobado* por ${ctx.from.first_name}`,
      { parse_mode: 'Markdown' },
    );
    // TODO: record outcome in agent memory
  });

  bot.callbackQuery(/^reject:(.+)$/, async (ctx) => {
    const suggestionId = ctx.match[1];
    log.info({ suggestionId, user: ctx.from.first_name }, 'Suggestion rejected');
    await ctx.answerCallbackQuery({ text: 'Rechazado' });
    await ctx.editMessageText(
      ctx.callbackQuery.message?.text + `\n\n*Rechazado* por ${ctx.from.first_name}`,
      { parse_mode: 'Markdown' },
    );
    // TODO: record outcome in agent memory
  });

  bot.callbackQuery(/^modify:(.+)$/, async (ctx) => {
    const suggestionId = ctx.match[1];
    log.info({ suggestionId, user: ctx.from.first_name }, 'Suggestion modification requested');
    await ctx.answerCallbackQuery({ text: 'Envía tu modificación como mensaje' });
    await ctx.editMessageText(
      ctx.callbackQuery.message?.text + `\n\n*Modificación solicitada* por ${ctx.from.first_name} — esperando respuesta...`,
      { parse_mode: 'Markdown' },
    );
  });
}
