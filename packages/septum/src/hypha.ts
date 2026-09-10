import type { HealthStatus, HyphaContext } from './context.js'
import type { ChannelIdentity, OutgoingContent } from './message.js'
import type { SporeModule } from './spore.js'

export interface Hypha<TConfig = unknown> {
  /** Opens the channel client. After this, send() works and nothing is emitted yet. */
  connect(ctx: HyphaContext<TConfig>): Promise<void>
  /**
   * Opens the gate to ctx.emit. The core calls it after every enzyme has started, so an
   * enzyme pushing from its own start() reaches a connected channel.
   */
  listen(): void
  stop(): Promise<void>
  send(conversationId: string, out: OutgoingContent): Promise<void>
  /** Present only when the manifest declares the group_membership capability. */
  listGroupMembers?(groupId: string): Promise<readonly ChannelIdentity[]>
  /**
   * Optional, unlike Rhiza's: not every channel has a probe to run beyond its own socket, and a
   * rhiza fronting a remote API — which always has one — is the outlier, not the rule.
   */
  health?(): Promise<HealthStatus>
}

export type HyphaModule<TConfig = unknown> = SporeModule<Hypha<TConfig>, TConfig>
