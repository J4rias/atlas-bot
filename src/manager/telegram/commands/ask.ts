import type { BotContext } from '../types.js';
import { runManagerAgent } from '../../agent/agent.js';
import { createLogger } from '../../../shared/logger.js';

const log = createLogger('manager').child({ command: 'ask' });

export async function askCommand(ctx: BotContext) {
  const text = ctx.message?.text ?? '';
  const question = text.replace(/^\/ask\s*/i, '').trim();

  if (!question) {
    await ctx.reply(
      'Usa: /ask `tu pregunta`\n\nEjemplo: /ask ¿Cuáles son los productos con menor rotación?',
      { parse_mode: 'Markdown' },
    );
    return;
  }

  await ctx.reply('Analizando...');

  try {
    const response = await runManagerAgent(question, {
      preamble:
        'Un jefe te hace esta pregunta directamente vía Telegram. ' +
        'Responde con datos concretos usando tus herramientas. ' +
        'Si no puedes obtener la información necesaria, dilo claramente.',
    });

    await ctx.reply(response);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg, question }, 'Ask command failed');
    await ctx.reply('Error al procesar tu pregunta. Revisa los logs.');
  }
}

/**
 * Handle freeform text messages (not commands).
 * Treated the same as /ask.
 */
export async function freeformHandler(ctx: BotContext) {
  const question = ctx.message?.text?.trim();
  if (!question) return;

  await ctx.reply('Analizando...');

  try {
    const response = await runManagerAgent(question, {
      preamble:
        'Un jefe te envía este mensaje directamente vía Telegram. ' +
        'Responde con datos concretos. Si es una pregunta, analiza y responde. ' +
        'Si es feedback sobre una sugerencia previa, registra el resultado en tu memoria.',
    });

    await ctx.reply(response);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg, question }, 'Freeform handler failed');
    await ctx.reply('Error al procesar tu mensaje. Revisa los logs.');
  }
}
