import type { HyphaContext } from './context.js'
import type { ChannelIdentity, OutgoingContent } from './message.js'
import type { SporeModule } from './spore.js'

export interface Hypha<TConfig = unknown> {
  start(ctx: HyphaContext<TConfig>): Promise<void>
  stop(): Promise<void>
  send(conversationId: string, out: OutgoingContent): Promise<void>
  /** Present only when the manifest declares the group_membership capability. */
  listGroupMembers?(groupId: string): Promise<readonly ChannelIdentity[]>
}

export type HyphaModule<TConfig = unknown> = SporeModule<Hypha<TConfig>, TConfig>
