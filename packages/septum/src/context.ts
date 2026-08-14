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

/** A key in a domain the caller does not own — what a rhiza hands back (design §5.3). */
export interface TranslatableRef {
  domain: string
  key: string
  params?: Record<string, unknown>
}

/**
 * Renders a catalogue key in the reader's language. A bare string is a key in the calling
 * spore's own domain; a ref names another domain, which must be one the manifest requires.
 * An absent key renders as the key itself rather than throwing (design §7.2).
 */
export type Translate = (
  key: string | TranslatableRef,
  params?: Record<string, unknown>,
  locale?: string,
) => string

export interface HyphaContext<TConfig = unknown> extends BaseContext<TConfig> {
  /** Hands a normalized inbound message to the rhizomorph. */
  emit(message: IncomingMessage): void
}

export interface RhizaContext<TConfig = unknown> extends BaseContext<TConfig> {
  /** Reserved: no subscriber exists yet, so the core discards what this emits. */
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
  /** Same signature as an enzyme's; `locale` defaults to config.defaultLocale, since
   *  admission runs before any principal is resolved. */
  readonly t: Translate
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
  /** Reserved: not implemented yet — the core throws (design §12). */
  on(rhiza: string, event: string, handler: (payload: unknown) => void): void
  /**
   * Omitting `locale` yields the locale resolved for the message being answered, or
   * config.defaultLocale in start(), where no message exists (design §5.1).
   */
  readonly t: Translate
  /** The language a conversation reads in — what a proactive push should pass to t(). */
  localeFor: (target: PushTarget) => Promise<string>
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
