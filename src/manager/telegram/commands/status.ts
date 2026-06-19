import type { BotContext } from '../types.js';
import { runManagerAgent } from '../../agent/agent.js';
import { createLogger } from '../../../shared/logger.js';
import { getThinkingMessage } from '../thinking.js';

const log = createLogger('manager').child({ command: 'status' });

export async function statusCommand(ctx: BotContext) {
  await ctx.reply(getThinkingMessage());

  try {
    const response = await runManagerAgent(
      'Dame un resumen ejecutivo del estado actual del negocio. ' +
      'Consulta productos, precios, tasas de cambio y cualquier dato relevante. ' +
      'Sé conciso: resumen en 5-8 líneas con los números clave.',
      {
        preamble: 'El usuario pidió un reporte de status rápido vía /status en Telegram.',
        maxTokens: 1024,
      },
    );

    await ctx.reply(response);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg }, 'Status command failed');
    await ctx.reply('Error al generar el reporte. Revisa los logs.');
  }
}
