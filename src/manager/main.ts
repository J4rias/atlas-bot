import { config, validateMode } from '../shared/config/index.js';
import { createLogger } from '../shared/logger.js';
import { createBot, stopBot } from './telegram/bot.js';
import { startCommand } from './telegram/commands/start.js';
import { statusCommand } from './telegram/commands/status.js';
import { askCommand, freeformHandler } from './telegram/commands/ask.js';
import { teachCommand } from './telegram/commands/teach.js';
import { registerCallbackHandlers } from './agent/escalation.js';
import { loadRegistry } from './agent/action-registry.js';
import { startScheduler, stopScheduler } from './scheduler/cron.js';

const log = createLogger('manager');

validateMode('manager');

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

let isShuttingDown = false;

async function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  log.info({ signal }, 'Shutting down manager...');

  stopScheduler();
  await stopBot();

  log.info('Manager stopped.');
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function start() {
  log.info('Starting Atlas Manager...');

  // Load action registry
  loadRegistry();

  if (!config.telegram.botToken) {
    log.warn('TELEGRAM_BOT_TOKEN not set — bot will not start. Set it in .env to enable.');
    log.info('Manager running in scheduler-only mode (no Telegram commands).');
  } else {
    // Initialize Telegram bot
    const bot = createBot();

    // Register commands
    bot.command('start', startCommand);
    bot.command('help', startCommand);
    bot.command('status', statusCommand);
    bot.command('ask', askCommand);
    bot.command('teach', teachCommand);

    // Register callback handlers for inline buttons
    registerCallbackHandlers();

    // Freeform text messages (treated as /ask)
    bot.on('message:text', freeformHandler);

    // Start bot (long polling)
    bot.start({
      onStart: () => {
        log.info('Telegram bot connected and listening');
      },
    });
  }

  // Start cron scheduler (runs regardless of bot)
  startScheduler();

  log.info('Atlas Manager is running.');
}

start().catch((err) => {
  log.error({ err }, 'Failed to start manager');
  process.exit(1);
});
