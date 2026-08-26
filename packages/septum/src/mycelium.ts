import type { FormSchema } from './config.js'
import type { HealthStatus, Principal, PushTarget } from './context.js'
import type { SporeKind } from './manifest.js'
import type { OutgoingContent } from './message.js'

/**
 * Scopes are split by consequence, not by resource, so a manifest reads as a statement
 * of what the plugin can do (core spec §6.1).
 */
export const MYCELIUM_SCOPES = [
  'principals.read',
  'principals.manage',
  'roles.read',
  'roles.assign',
  'roles.manage',
  'plugins.read',
  'plugins.toggle',
  'plugins.configure',
  'health.read',
  'messages.send',
  'messages.broadcast',
  'conversations.read',
  'restrictions.manage',
  'locale.manage',
  'commands.read',
] as const

export type MyceliumScope = (typeof MYCELIUM_SCOPES)[number]

export interface PluginInfo {
  name: string
  /** Absent when the spore went dormant before its manifest parsed. */
  kind?: SporeKind
  /** Short command names, empty for any kind that declares none. */
  commands: readonly string[]
  /**
   * 'germinated' and 'dormant' are what germination reached; 'disabled' is an install
   * row the operator switched off, which germination skips without loading it.
   */
  state: 'germinated' | 'dormant' | 'disabled'
  /** Present only when dormant. */
  reason?: string
  /**
   * Enabled as of the germination that produced this entry. A later enable() or
   * disable() is reflected only by the next germination, so a settings UI must not
   * render its toggle from this field alone.
   */
  enabled: boolean
}

export interface RhizaHealth {
  rhiza: string
  status: HealthStatus
}

// One interface per implemented scope. A scope that a phase cannot mount gets no type,
// so a plugin cannot typecheck against a method that does not exist.
export interface PluginsRead {
  listPlugins(): readonly PluginInfo[]
}

export interface HealthRead {
  health(): Promise<readonly RhizaHealth[]>
}

export interface MessagesSend {
  send(target: PushTarget, content: OutgoingContent): Promise<void>
}

export interface RoleInfo {
  name: string
  patterns: readonly string[]
  builtin: boolean
}

// Lookups answer null for "not found", because asking is their purpose; everything
// that acts on a named principal or role rejects instead, naming what was missing.
export interface PrincipalsRead {
  listPrincipals(): Promise<readonly Principal[]>
  /** Resolves null when no principal carries that id. */
  getPrincipal(id: string): Promise<Principal | null>
  /** Resolves null when that channel identity has never been seen. */
  findByIdentity(channel: string, externalId: string): Promise<Principal | null>
}

export interface PrincipalsManage {
  /** Rejects when the principal does not exist. */
  markReviewed(id: string): Promise<void>
  /** Rejects when the principal does not exist. */
  setDisplayName(id: string, displayName: string): Promise<void>
}

export interface RolesRead {
  listRoles(): Promise<readonly RoleInfo[]>
  /** Resolves an empty list for an unknown principal, which holds no role either way. */
  rolesOf(principalId: string): Promise<readonly string[]>
}

export interface RolesAssign {
  /** Rejects when the principal or the role does not exist. Assigning twice is a no-op. */
  assignRole(principalId: string, roleName: string): Promise<void>
  /** Rejects when the principal or the role does not exist. Revoking one not held is a no-op. */
  revokeRole(principalId: string, roleName: string): Promise<void>
}

export interface RolesManage {
  /** Rejects when the name is empty, already taken, or a pattern is repeated. */
  createRole(name: string, patterns: readonly string[]): Promise<void>
  /** Replaces the patterns wholesale. Rejects when the role does not exist, is `builtin`, or a pattern is repeated. */
  setRoleCommands(name: string, patterns: readonly string[]): Promise<void>
  /** Rejects when the role does not exist or is `builtin`. */
  deleteRole(name: string): Promise<void>
}

export interface PluginsToggle {
  /** Rejects when the stored settings fail the plugin's own configSchema, quoting what it reported. */
  enable(name: string): Promise<void>
  /** Rejects when the plugin is not installed. */
  disable(name: string): Promise<void>
}

export interface PluginsConfigure {
  /**
   * Rejects when the plugin is not installed. Secret values come back as the literal
   * string '••••', never the value itself.
   */
  settings(name: string): Promise<Record<string, unknown>>
  /**
   * Rejects when the plugin is not installed, and when it publishes a JSON Schema that
   * neither declares the key nor allows additional properties — such a key would be
   * dropped at validation for a loose schema, or rejected outright by a strict one.
   */
  setSetting(name: string, key: string, value: unknown): Promise<void>
  /** Resolves an `available: false` FormSchema rather than rejecting, whatever went wrong. */
  formSchema(name: string): Promise<FormSchema>
}

// A runtime constant, not just a type: the core's onOutOfContext renders `context.${where}`
// against its own catalogue, so both sides need one source of truth to pin against.
export const CONVERSATION_KINDS = ['dm', 'group'] as const

export type ConversationKind = (typeof CONVERSATION_KINDS)[number]

/** One conversation the bot has seen. No message is ever stored. */
export interface ConversationInfo {
  channel: string
  conversationId: string
  kind: ConversationKind
  /** The group's name, or the sender's display name for a DM. Absent when the channel gave none. */
  label?: string
  firstSeenAt: Date
  lastMessageAt: Date
}

export interface ConversationsRead {
  listConversations(): Promise<readonly ConversationInfo[]>
}

export interface BroadcastResult {
  target: PushTarget
  ok: boolean
  /** Present only when `ok` is false. */
  error?: string
}

export interface MessagesBroadcast {
  /**
   * Sends to every target the operator configured — the plugin chooses none of them.
   * One entry per target, ordered by channel then conversation id (the store keeps no
   * configuration order): a dead target never cancels the others.
   */
  broadcast(content: OutgoingContent): Promise<readonly BroadcastResult[]>
}

/** Where a command pattern is allowed to run. No rule at all means anywhere. */
export interface ContextRule {
  pattern: string
  where: ConversationKind
}

/**
 * Confining an inhibitor's channels or clearing a context rule takes effect on the very
 * next message, with no restart — unlike `plugins.toggle`'s `disable()`, which only
 * applies at the next germination. Granting this scope can take an `enforcing`
 * inhibitor off a channel live.
 */
export interface RestrictionsManage {
  listContextRules(): Promise<readonly ContextRule[]>
  /**
   * Replaces the rule for that exact pattern. Rejects a pattern outside the three forms
   * `*`, `<plugin>.*`, `<plugin>.<command>` — one that matched nothing would silently
   * drop the restriction instead of applying it.
   */
  setContextRule(pattern: string, where: ConversationKind): Promise<void>
  /** Clearing a pattern that carries no rule is a no-op. */
  clearContextRule(pattern: string): Promise<void>
  /** The channels an inhibitor is confined to. Empty means every channel. Rejects an uninstalled plugin. */
  inhibitorChannels(name: string): Promise<readonly string[]>
  /**
   * Replaces the list wholesale; an empty list restores every channel. Rejects an
   * uninstalled plugin. A channel name is not checked against what is installed — a
   * typo'd confinement silently does nothing.
   */
  setInhibitorChannels(name: string, channels: readonly string[]): Promise<void>
  listBroadcastTargets(): Promise<readonly PushTarget[]>
  /**
   * Adding the same target twice is a no-op. Neither the channel nor the conversation id
   * is validated — a typo'd target is accepted and never delivers.
   */
  addBroadcastTarget(target: PushTarget): Promise<void>
  /** Removing one that is not configured is a no-op. */
  removeBroadcastTarget(target: PushTarget): Promise<void>
}

export interface ArgInfo {
  /** As declared in the manifest, and as `Invocation.args` keys it. */
  name: string
  /** Rendered text, falling back to the default locale and then to the key itself. */
  description: string
  /**
   * Shown by a help surface. The core does **not** refuse an invocation missing it: a
   * handler owns its own absent-argument answer, which it can phrase in the reader's
   * language and with the command's exact syntax. See `ArgSpec.required`.
   */
  required: boolean
}

export interface CommandInfo {
  /** The authorization identifier: 'plugin.command'. */
  qualified: string
  /** Short name, as typed after the prefix. */
  name: string
  /** The spore declaring the command, and the catalogue domain its description came from. */
  plugin: string
  /** Rendered text, falling back to the default locale and then to the key itself. */
  description: string
  /** Absent when the command declares none. Positional, in declaration order. */
  args?: readonly ArgInfo[]
}

/**
 * The core filters and renders, because it holds the pattern matcher and every catalogue;
 * a spore can only render its own domain and those its manifest requires (design §6).
 */
export interface CommandsRead {
  /**
   * Commands this principal is *authorized* to invoke, sorted by `qualified`, described in
   * this locale. Channel capabilities and context rules are applied at dispatch, not here —
   * a listed command can still be refused on the channel it is asked on.
   * The principal is a parameter because a mycelium rhiza is mounted once per plugin,
   * not once per invocation — so a spore holding any principal's id learns that principal's
   * authorized command set without holding `roles.read` (design §6).
   */
  available(principal: Principal, locale: string): Promise<readonly CommandInfo[]>
}

export interface LocaleManage {
  /**
   * Rejects for an unknown principal, for a tag that is not valid BCP-47, and for a locale
   * no catalogue provides — accepting the last would silently answer in the fallback forever.
   */
  setPrincipalLocale(principalId: string, locale: string): Promise<void>
  /** Rejects for a conversation the bot has never seen, alongside the same two faults. */
  setConversationLocale(channel: string, conversationId: string, locale: string): Promise<void>
  /** Locales at least one catalogue provides, canonical and sorted. Synchronous, like listPlugins(). */
  availableLocales(): readonly string[]
}
