import type { Capabilities, ChannelCapability } from './capabilities.js'
import type { Logger } from './logger.js'
import type { ChannelIdentity, IncomingMessage, OutgoingContent } from './message.js'

/** Where a proactive message goes. */
export interface PushTarget {
  channel: string
  conversationId: string
}

export type HealthState = 'healthy' | 'degraded' | 'unreachable'

export interface HealthStatus {
  state: HealthState
  detail?: string
  checkedAt: Date
}

/** A person, independent of the channel they speak through. */
export interface Principal {
  id: string
  displayName?: string
  identities: readonly ChannelIdentity[]
  roles: readonly string[]
}

/** One parsed command call. */
export interface Invocation {
  /** Short command name, as declared in the manifest. */
  command: string
  /** Named arguments, per the manifest's arg specs. */
  args: Readonly<Record<string, string>>
  /** Everything after the command, unparsed. */
  rest: string
  message: IncomingMessage
}

interface BaseContext<TConfig> {
  readonly config: TConfig
  readonly logger: Logger
}

export interface HyphaContext<TConfig = unknown> extends BaseContext<TConfig> {
  /** Hands a normalized inbound message to the rhizomorph. */
  emit(message: IncomingMessage): void
}

export interface RhizaContext<TConfig = unknown> extends BaseContext<TConfig> {
  /** Emit a domain event enzymes can subscribe to via EnzymeContext.on(). */
  emit(event: string, payload: unknown): void
}

export interface InhibitorContext<TConfig = unknown> extends BaseContext<TConfig> {
  /**
   * Members of a group on a channel, or null when the channel cannot report them.
   * Cached with a TTL by the core (spec §5.1). An inhibitor wanting a fallback source
   * fetches its own through rhiza().
   */
  groupMembers(channel: string, groupId: string): Promise<readonly ChannelIdentity[] | null>
  /** Throws when the channel cannot enforce a rule this inhibitor needs (design §7). */
  requireCapability(channel: string, capability: ChannelCapability): void
  rhiza<TApi>(name: string): TApi
  has(name: string): boolean
}

/**
 * What an enzyme gets during start(), before any message exists.
 *
 * Excludes everything that only makes sense in response to a message: no sender
 * to attribute, no conversation to reply into, no channel capabilities. A single
 * context for both moments would have to hand start() a fabricated principal and
 * a reply() that throws.
 */
export interface EnzymeStartContext<TConfig = unknown> extends BaseContext<TConfig> {
  /** Proactive send to an explicitly named target. */
  push(target: PushTarget, content: OutgoingContent): Promise<void>
  /**
   * A germinated rhiza's public API. TApi comes from importing the rhiza's own
   * types; the core cannot verify it, so this is an assertion by the author.
   */
  rhiza<TApi>(name: string): TApi
  /** Whether an optional or any_of dependency resolved. */
  has(name: string): boolean
  capabilitiesOf(target: PushTarget): Capabilities
  /** Subscribe to a rhiza event. */
  on(rhiza: string, event: string, handler: (payload: unknown) => void): void
}

/**
 * What an enzyme gets while handling a command. Adds what only exists once a
 * message has arrived: who sent it, where to answer, and what that channel can do.
 */
export interface EnzymeContext<TConfig = unknown> extends EnzymeStartContext<TConfig> {
  reply(content: OutgoingContent): Promise<void>
  /** Capabilities of the conversation being answered. */
  readonly capabilities: Capabilities
  readonly principal: Principal
}
