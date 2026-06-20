import type { BotContext } from '../types.js';
import { saveTeaching } from '../../../shared/db/repositories/kb.repo.js';
import { createLogger } from '../../../shared/logger.js';

const log = createLogger('manager').child({ command: 'teach' });

const CATEGORIES = new Set(['arbitraje', 'clientes', 'productos', 'monedas', 'region', 'temporada', 'general']);

const USAGE =
  'Uso: /teach [texto]\n\n' +
  'Opcionalmente empieza con una categoria: arbitraje, clientes, productos, monedas, region, temporada, general\n\n' +
  'Ejemplos:\n' +
  '  /teach los domingos no se trabaja, solo de lunes a sabado\n' +
  '  /teach arbitraje cuando la tasa sube mas de 3%, los bodegueros frenan compras por 48h\n' +
  '  /teach clientes los mayoristas de Ureña compran los lunes\n' +
  '  /teach la harina PAN sube 30% en diciembre por las hallacas';

export async function teachCommand(ctx: BotContext) {
  const text = ctx.message?.text ?? '';
  const args = text.replace(/^\/teach\s*/i, '').trim();

  if (!args) {
    await ctx.reply(USAGE);
    return;
  }

  // Try to parse category from first word, default to 'general' if not a valid category
  const spaceIdx = args.indexOf(' ');
  let category = 'general';
  let content = args;

  if (spaceIdx !== -1) {
    const firstWord = args.slice(0, spaceIdx).toLowerCase();
    if (CATEGORIES.has(firstWord)) {
      category = firstWord;
      content = args.slice(spaceIdx + 1).trim();
    }
  }

  if (!content) {
    await ctx.reply(USAGE);
    return;
  }

  try {
    const userName = ctx.from?.first_name ?? 'unknown';
    await saveTeaching(category, content, userName);

    log.info({ category, content: content.slice(0, 80), taughtBy: userName }, 'Knowledge taught');
    await ctx.reply(`Aprendido (${category}). Usare este conocimiento en futuros analisis.`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg }, 'Failed to save teaching');
    await ctx.reply('Error al guardar el conocimiento. Revisa los logs.');
  }
}
