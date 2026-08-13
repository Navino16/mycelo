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

export type ConversationKind = 'dm' | 'group'

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
   * One entry per target, in configuration order: a dead target never cancels the others.
   */
  broadcast(content: OutgoingContent): Promise<readonly BroadcastResult[]>
}

/** Where a command pattern is allowed to run. No rule at all means anywhere. */
export interface ContextRule {
  pattern: string
  where: ConversationKind
}

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
  /** The channels an inhibitor is confined to. Empty means every channel. */
  inhibitorChannels(name: string): Promise<readonly string[]>
  /** Replaces the list wholesale; an empty list restores every channel. Rejects an uninstalled plugin. */
  setInhibitorChannels(name: string, channels: readonly string[]): Promise<void>
  listBroadcastTargets(): Promise<readonly PushTarget[]>
  /** Adding the same target twice is a no-op. */
  addBroadcastTarget(target: PushTarget): Promise<void>
  /** Removing one that is not configured is a no-op. */
  removeBroadcastTarget(target: PushTarget): Promise<void>
}
