import type { IncomingMessage } from '@mycelo/septum'

/**
 * Stamps the emitting channel and rejects what a hypha must never omit.
 * `conversationId` and `messageId` are required from day one (spec §2.1) even though
 * nothing reads them yet: retrofitting either means rewriting every hypha.
 */
export function normalize(channel: string, raw: IncomingMessage): IncomingMessage {
  if (raw.conversationId === '') throw new Error(`hypha '${channel}' emitted a message with no conversationId`)
  if (raw.messageId === '') throw new Error(`hypha '${channel}' emitted a message with no messageId`)
  return { ...raw, channel }
}
