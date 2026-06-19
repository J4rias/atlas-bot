import type { BotContext } from '../types.js';

export async function whoamiCommand(ctx: BotContext) {
  const user = ctx.from;
  const chat = ctx.chat;
  if (!user || !chat) return;

  const lines = [
    `*Tu info:*`,
    `ID personal: \`${user.id}\``,
    `Nombre: ${user.first_name}${user.last_name ? ' ' + user.last_name : ''}`,
    user.username ? `Username: @${user.username}` : null,
    '',
    `*Este chat:*`,
    `Chat ID: \`${chat.id}\``,
    `Tipo: ${chat.type}`,
  ].filter(Boolean);

  await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
}
