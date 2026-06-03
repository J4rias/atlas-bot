import type { BotContext } from '../types.js';

export async function startCommand(ctx: BotContext) {
  await ctx.reply(
    `*Manager de Negocios — Inversiones Atlas*

Soy tu asistente estratégico autónomo. Analizo el negocio y te reporto lo relevante.

*Comandos disponibles:*
/status — Resumen rápido de KPIs
/ask \`pregunta\` — Hazme una pregunta sobre el negocio
/help — Ver esta ayuda

También envío diagnósticos automáticos cada hora si detecto algo importante.`,
    { parse_mode: 'Markdown' },
  );
}
