import { Bot, session } from 'grammy';
import { config } from '../../shared/config/index.js';
import { createLogger } from '../../shared/logger.js';
import { authMiddleware } from './middleware.js';
import { whoamiCommand } from './commands/whoami.js';
import type { BotContext, SessionData } from './types.js';

const log = createLogger('manager').child({ module: 'bot' });

let bot: Bot<BotContext> | null = null;

export function createBot(): Bot<BotContext> {
  if (!config.telegram.botToken) {
    throw new Error('TELEGRAM_BOT_TOKEN is required to start the Manager');
  }

  bot = new Bot<BotContext>(config.telegram.botToken);

  // Session middleware (in-memory for now)
  bot.use(
    session<SessionData, BotContext>({
      initial: () => ({}),
    }),
  );

  // /whoami is public — anyone can check their ID (registered before auth)
  bot.command('whoami', whoamiCommand);

  // Auth: only authorized recipients can interact
  bot.use(authMiddleware);

  // Error handler
  bot.catch((err) => {
    log.error({ err: err.error ?? err.message, stack: err.stack }, 'Bot error');
  });

  return bot;
}

export function getBot(): Bot<BotContext> | null {
  return bot;
}

export async function stopBot(): Promise<void> {
  if (bot) {
    bot.stop();
    log.info('Telegram bot stopped');
  }
}
