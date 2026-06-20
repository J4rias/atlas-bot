import type { BotContext } from '../types.js';
import { saveTeaching } from '../../../shared/db/repositories/kb.repo.js';
import { createLogger } from '../../../shared/logger.js';

const log = createLogger('manager').child({ command: 'teach' });

const CATEGORIES = ['arbitraje', 'clientes', 'productos', 'monedas', 'region', 'temporada', 'general'] as const;

const USAGE =
  'Uso: /teach [categoria] [conocimiento]\n\n' +
  'Categorias: arbitraje, clientes, productos, monedas, region, temporada, general\n\n' +
  'Ejemplos:\n' +
  '  /teach arbitraje Cuando la tasa sube mas de 3% en un dia, los bodegueros frenan compras por 48h\n' +
  '  /teach clientes Los mayoristas de Ureña compran los lunes porque reciben transferencias de Colombia el viernes\n' +
  '  /teach productos La harina PAN sube 30% en diciembre por las hallacas\n' +
  '  /teach monedas Los colombianos prefieren pagar en efectivo COP, no Bancolombia, porque les cobran comision';

export async function teachCommand(ctx: BotContext) {
  const text = ctx.message?.text ?? '';
  const args = text.replace(/^\/teach\s*/i, '').trim();

  if (!args) {
    await ctx.reply(USAGE);
    return;
  }

  // Parse: first word is category, rest is content
  const spaceIdx = args.indexOf(' ');
  if (spaceIdx === -1) {
    await ctx.reply(USAGE);
    return;
  }

  const categoryInput = args.slice(0, spaceIdx).toLowerCase();
  const content = args.slice(spaceIdx + 1).trim();

  if (!content) {
    await ctx.reply(USAGE);
    return;
  }

  const category = CATEGORIES.find((c) => c === categoryInput);
  if (!category) {
    await ctx.reply(
      `Categoria "${categoryInput}" no valida.\n\nCategorias disponibles: ${CATEGORIES.join(', ')}`,
    );
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
