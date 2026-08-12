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

export interface PrincipalsRead {
  listPrincipals(): Promise<readonly Principal[]>
  getPrincipal(id: string): Promise<Principal | null>
  findByIdentity(channel: string, externalId: string): Promise<Principal | null>
}

export interface PrincipalsManage {
  markReviewed(id: string): Promise<void>
  setDisplayName(id: string, displayName: string): Promise<void>
}

export interface RolesRead {
  listRoles(): Promise<readonly RoleInfo[]>
  rolesOf(principalId: string): Promise<readonly string[]>
}

export interface RolesAssign {
  assignRole(principalId: string, roleName: string): Promise<void>
  revokeRole(principalId: string, roleName: string): Promise<void>
}

export interface RolesManage {
  createRole(name: string, patterns: readonly string[]): Promise<void>
  setRoleCommands(name: string, patterns: readonly string[]): Promise<void>
  deleteRole(name: string): Promise<void>
}
