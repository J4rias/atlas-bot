import axios from 'axios';
import { config } from '../../../shared/config/index.js';
import { createLogger } from '../../../shared/logger.js';

const log = createLogger('consultant').child({ channel: 'messenger' });

const GRAPH_API = 'https://graph.facebook.com/v21.0/me';

async function callSendApi(body: unknown) {
  if (!config.meta.pageAccessToken) {
    log.warn('META_PAGE_ACCESS_TOKEN not set — message not sent');
    return;
  }

  try {
    await axios.post(`${GRAPH_API}/messages`, body, {
      params: { access_token: config.meta.pageAccessToken },
      timeout: 10_000,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg }, 'Failed to send message');
  }
}

/** Send a text message to a user. Splits long messages into chunks. */
export async function sendText(recipientId: string, text: string): Promise<void> {
  // Messenger has a 2000 char limit per message
  const MAX_LEN = 2000;
  const chunks: string[] = [];

  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= MAX_LEN) {
      chunks.push(remaining);
      break;
    }
    // Try to break at a newline or space
    let breakAt = remaining.lastIndexOf('\n', MAX_LEN);
    if (breakAt < MAX_LEN / 2) breakAt = remaining.lastIndexOf(' ', MAX_LEN);
    if (breakAt < MAX_LEN / 2) breakAt = MAX_LEN;

    chunks.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt).trimStart();
  }

  for (const chunk of chunks) {
    await callSendApi({
      recipient: { id: recipientId },
      message: { text: chunk },
      messaging_type: 'RESPONSE',
    });
  }
}

/** Show "typing..." indicator. */
export async function sendTypingOn(recipientId: string): Promise<void> {
  await callSendApi({
    recipient: { id: recipientId },
    sender_action: 'typing_on',
  });
}

/** Hide typing indicator. */
export async function sendTypingOff(recipientId: string): Promise<void> {
  await callSendApi({
    recipient: { id: recipientId },
    sender_action: 'typing_off',
  });
}

/** Send a message with quick reply buttons. */
export async function sendQuickReplies(
  recipientId: string,
  text: string,
  replies: { title: string; payload: string }[],
): Promise<void> {
  await callSendApi({
    recipient: { id: recipientId },
    message: {
      text,
      quick_replies: replies.map((r) => ({
        content_type: 'text',
        title: r.title,
        payload: r.payload,
      })),
    },
    messaging_type: 'RESPONSE',
  });
}
