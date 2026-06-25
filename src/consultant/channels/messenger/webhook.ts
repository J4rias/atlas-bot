import { Router, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import { config } from '../../../shared/config/index.js';
import { createLogger } from '../../../shared/logger.js';
import type { WebhookBody, MessagingEvent } from './types.js';

const log = createLogger('consultant').child({ channel: 'messenger' });

export type MessageHandler = (senderId: string, text: string) => Promise<void>;

let onMessage: MessageHandler = async () => {};

/** Register the handler that will process incoming text messages. */
export function setMessageHandler(handler: MessageHandler) {
  onMessage = handler;
}

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

function verifySignature(req: Request & { rawBody?: Buffer }): boolean {
  const secret = config.meta.appSecret;
  if (!secret) return true; // skip in dev if not configured

  const signature = req.headers['x-hub-signature-256'] as string | undefined;
  if (!signature) return false;

  const rawBody = req.rawBody;
  if (!rawBody) return false;

  const expected =
    'sha256=' +
    crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected),
  );
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const messengerRouter = Router();

// GET — Webhook verification (Meta sends this to validate)
messengerRouter.get('/', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.meta.verifyToken) {
    log.info('Webhook verified');
    res.status(200).send(challenge);
  } else {
    log.warn({ mode, token }, 'Webhook verification failed');
    res.sendStatus(403);
  }
});

// POST — Incoming messages
messengerRouter.post('/', (req: Request, res: Response) => {
  if (!verifySignature(req as Request & { rawBody?: Buffer })) {
    log.warn('Invalid webhook signature — rejecting');
    res.sendStatus(403);
    return;
  }

  // Always respond 200 quickly to avoid Meta retries
  res.sendStatus(200);

  const body = req.body as WebhookBody;

  if (body.object !== 'page') return;

  for (const entry of body.entry) {
    for (const event of entry.messaging) {
      processEvent(event).catch((err) => {
        log.error({ err, senderId: event.sender.id }, 'Error processing message');
      });
    }
  }
});

async function processEvent(event: MessagingEvent) {
  // Skip delivery/read receipts
  if (event.delivery || event.read) return;

  const senderId = event.sender.id;

  // Handle text messages
  if (event.message?.text) {
    log.info({ senderId, text: event.message.text.slice(0, 100) }, 'Incoming message');
    await onMessage(senderId, event.message.text);
    return;
  }

  // Handle quick reply buttons
  if (event.message?.quick_reply) {
    log.info({ senderId, payload: event.message.quick_reply.payload }, 'Quick reply');
    await onMessage(senderId, event.message.quick_reply.payload);
    return;
  }

  // Handle postbacks (menu buttons)
  if (event.postback) {
    log.info({ senderId, payload: event.postback.payload }, 'Postback');
    await onMessage(senderId, event.postback.payload);
    return;
  }

  // Attachments (images, files, etc.) — acknowledge but don't process yet
  if (event.message?.attachments) {
    log.info({ senderId, types: event.message.attachments.map((a) => a.type) }, 'Attachment received');
    await onMessage(senderId, '[El cliente envió un archivo adjunto]');
  }
}
