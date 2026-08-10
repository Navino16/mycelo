/** One person's identity on one channel. Distinct from a principal: see spec §2.1. */
export interface ChannelIdentity {
  channel: string
  externalId: string
  displayName?: string
}

/**
 * A file travelling in either direction. `url` avoids buffering large media;
 * `bytes` is for content the plugin already holds.
 *
 * `Uint8Array` rather than `Buffer`: keeping the public contract free of
 * Node-specific types means a plugin author needs no @types/node to typecheck
 * against it. A Node `Buffer` is assignable here.
 */
export type Attachment =
  | { kind: 'url'; url: string; mime?: string; filename?: string }
  | { kind: 'bytes'; data: Uint8Array; mime: string; filename?: string }

/** The only inbound shape the core understands. Produced by a hypha. */
export interface IncomingMessage {
  /** Name of the emitting hypha. */
  channel: string
  /** Opaque: a thread, a group or a DM. Required from day one — see spec §2.1. */
  conversationId: string
  /** Opaque, and what makes a reaction addressable. Required from day one. */
  messageId: string
  /** Present only when the conversation is a group. */
  group?: { id: string }
  sender: ChannelIdentity
  text: string
  attachments: Attachment[]
  /** Native payload. A deliberate escape hatch for channel-specific needs. */
  raw: unknown
  receivedAt: Date
}

/**
 * What an enzyme sends. Every field is optional but at least one must be set;
 * that invariant is enforced by the core, not by the type, so a plugin gets a
 * clear runtime error rather than an unreadable type error.
 */
export interface OutgoingContent {
  text?: string
  attachments?: Attachment[]
  reactTo?: { messageId: string; emoji: string }
}
