import type { IncomingMessage } from '@mycelo/septum'

/**
 * Stamps the emitting channel and rejects what a hypha must never omit.
 * `conversationId` and `messageId` are required from day one (spec §2.1) even though
 * nothing reads them yet: retrofitting either means rewriting every hypha.
 */
export function normalize(channel: string, raw: IncomingMessage): IncomingMessage {
  if (typeof raw.conversationId !== 'string' || raw.conversationId === '') throw new Error(`hypha '${channel}' emitted a message with no conversationId`)
  if (typeof raw.messageId !== 'string' || raw.messageId === '') throw new Error(`hypha '${channel}' emitted a message with no messageId`)
  // bus.ts's very next statement is text.startsWith(prefix): an image-only message
  // with no text — the natural shape on Discord, Signal and WhatsApp — must fail
  // here with a named field, not one call later with a raw TypeError. Unlike
  // conversationId and messageId, an empty string is a legitimate caption-less text.
  if (typeof raw.text !== 'string') throw new Error(`hypha '${channel}' emitted a message with no text`)
  // attachments is equally non-optional and the bus forwards it unread today, but a
  // future consumer will call .length or .map() on it without expecting to guard
  // against undefined — guarded at the same boundary as its siblings, not wherever
  // that consumer happens to be.
  if (!Array.isArray(raw.attachments)) throw new Error(`hypha '${channel}' emitted a message with no attachments`)
  return { ...raw, channel }
}
