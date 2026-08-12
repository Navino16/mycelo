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
  state: 'germinated' | 'dormant'
  /** Present only when dormant. */
  reason?: string
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
