import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, validateMode } from '../shared/config/index.js';
import { createLogger } from '../shared/logger.js';
import { catalogRouter } from './routes/catalog.js';
import { messengerRouter, setMessageHandler } from './channels/messenger/webhook.js';
import * as messenger from './channels/messenger/sender.js';
import { getConversation, addUserMessage, activeCount } from './conversation/manager.js';
import { getAgentResponse } from './conversation/agent.js';
import { closePool } from '../shared/db/client.js';

const log = createLogger('consultant');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

validateMode('consultant');

// ---------------------------------------------------------------------------
// Wire the message handler: Messenger → Conversation Manager → Claude → Reply
// ---------------------------------------------------------------------------

setMessageHandler(async (senderId, text) => {
  try {
    // Show typing indicator while we process
    await messenger.sendTypingOn(senderId);

    // Get or create conversation for this sender
    const conversation = getConversation(senderId, 'messenger');

    // Add the user's message
    addUserMessage(conversation, text);

    // Get Claude's response (may involve tool calls)
    const response = await getAgentResponse(conversation);

    // Send the response back
    await messenger.sendText(senderId, response);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg, senderId }, 'Failed to handle message');

    await messenger.sendText(
      senderId,
      'Disculpe, estoy teniendo dificultades técnicas. Por favor intente de nuevo en un momento.',
    );
  }
});

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, '..', '..', 'public')));
app.use(express.json({
  verify: (req, _res, buf) => {
    (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
  },
}));

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    mode: 'consultant',
    activeConversations: activeCount(),
  });
});

// Messenger webhook
app.use('/webhook', messengerRouter);

// Product catalog (web)
app.use('/catalogo', catalogRouter);

app.get('/', (_req, res) => {
  res.redirect('/catalogo');
});

const server = app.listen(config.port, () => {
  log.info({ port: config.port }, 'Atlas Consultant running');
  log.info(`  Catalog: http://localhost:${config.port}/catalogo`);
  log.info(`  Webhook: http://localhost:${config.port}/webhook`);
});

// Graceful shutdown
let isShuttingDown = false;
async function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  log.info({ signal }, 'Shutting down consultant...');
  server.close();
  await closePool();
  log.info('Consultant stopped.');
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
