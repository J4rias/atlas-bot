/** Abstract interface for a messaging channel (Messenger, WhatsApp, etc.). */
export interface Channel {
  /** Send a plain text reply. */
  sendText(recipientId: string, text: string): Promise<void>;
  /** Show "typing..." indicator. */
  sendTypingOn(recipientId: string): Promise<void>;
  /** Send quick-reply buttons. */
  sendQuickReplies(
    recipientId: string,
    text: string,
    replies: { title: string; payload: string }[],
  ): Promise<void>;
}
