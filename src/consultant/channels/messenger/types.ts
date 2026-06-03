// ---------------------------------------------------------------------------
// Meta Messenger webhook payload types
// ---------------------------------------------------------------------------

export interface WebhookEntry {
  id: string;
  time: number;
  messaging: MessagingEvent[];
}

export interface WebhookBody {
  object: string;
  entry: WebhookEntry[];
}

export interface MessagingEvent {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: IncomingMessage;
  postback?: Postback;
  delivery?: unknown;
  read?: unknown;
}

export interface IncomingMessage {
  mid: string;
  text?: string;
  attachments?: Attachment[];
  quick_reply?: { payload: string };
}

export interface Attachment {
  type: 'image' | 'video' | 'audio' | 'file' | 'location';
  payload: { url?: string };
}

export interface Postback {
  title: string;
  payload: string;
}
