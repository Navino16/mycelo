/**
 * What a channel can do. A hypha declares its subset in its manifest; the core
 * exposes the resolved set to enzymes as a Capabilities view.
 */
export const CHANNEL_CAPABILITIES = [
  'attachments',
  'reactions',
  'threads',
  'group_membership',
] as const

export type ChannelCapability = (typeof CHANNEL_CAPABILITIES)[number]

/**
 * Capabilities of one target — a conversation, or another channel for a push.
 * Relative to the target and never global: see spec §3.2.
 */
export interface Capabilities {
  has(capability: ChannelCapability): boolean
  list(): readonly ChannelCapability[]
}
