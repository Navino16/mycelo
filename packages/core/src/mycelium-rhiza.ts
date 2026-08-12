import { and, eq } from 'drizzle-orm'
import type {
  HealthRead,
  MessagesSend,
  MyceliumScope,
  OutgoingContent,
  Principal,
  PluginInfo,
  PluginsRead,
  PrincipalsManage,
  PrincipalsRead,
  PushTarget,
  RhizaHealth,
  RoleInfo,
  RolesAssign,
  RolesManage,
  RolesRead,
} from '@mycelo/septum'
import type { Registry } from './germination/registry.js'
import type { Db } from './persistence/db.js'
import { channelIdentity, principal, principalRole, role, roleCommand } from './persistence/schema.js'

function listPlugins(registry: Registry): readonly PluginInfo[] {
  const germinated: PluginInfo[] = [
    ...registry.hyphae.map((h) => ({ name: h.name, kind: h.manifest.kind, commands: [], state: 'germinated' as const })),
    ...registry.enzymes.map((e) => ({
      name: e.name,
      kind: e.manifest.kind,
      commands: e.manifest.commands.map((c) => c.name),
      state: 'germinated' as const,
    })),
    ...registry.rhizas.map((r) => ({ name: r.name, kind: r.manifest.kind, commands: [], state: 'germinated' as const })),
  ]
  // Dormant carries no kind: a spore may fail before its manifest ever parses.
  const dormant: PluginInfo[] = registry.dormant.map((d) => ({
    name: d.name,
    commands: [],
    state: 'dormant' as const,
    reason: d.reason,
  }))
  return [...germinated, ...dormant]
}

async function aggregateHealth(registry: Registry): Promise<readonly RhizaHealth[]> {
  return Promise.all(registry.rhizas.map(async (r) => ({ rhiza: r.name, status: await r.instance.health() })))
}

function loadPrincipal(db: Db, principalId: string): Principal | null {
  const row = db.select().from(principal).where(eq(principal.id, principalId)).get()
  if (row === undefined) return null
  const identities = db
    .select({
      channel: channelIdentity.channel,
      externalId: channelIdentity.externalId,
      displayName: channelIdentity.displayName,
    })
    .from(channelIdentity)
    .where(eq(channelIdentity.principalId, principalId))
    .all()
  const roles = db
    .select({ name: role.name })
    .from(principalRole)
    .innerJoin(role, eq(role.id, principalRole.roleId))
    .where(eq(principalRole.principalId, principalId))
    .all()
  return {
    id: row.id,
    ...(row.displayName === null ? {} : { displayName: row.displayName }),
    identities: identities.map((i) => ({
      channel: i.channel,
      externalId: i.externalId,
      ...(i.displayName === null ? {} : { displayName: i.displayName }),
    })),
    roles: roles.map((r) => r.name),
  }
}

function listPrincipals(db: Db): readonly Principal[] {
  return db.select({ id: principal.id }).from(principal).all().map((r) => {
    const p = loadPrincipal(db, r.id)
    if (p === null) throw new Error(`principal '${r.id}' vanished mid-listing`)
    return p
  })
}

function findByIdentity(db: Db, channel: string, externalId: string): Principal | null {
  const row = db
    .select({ principalId: channelIdentity.principalId })
    .from(channelIdentity)
    .where(and(eq(channelIdentity.channel, channel), eq(channelIdentity.externalId, externalId)))
    .get()
  return row === undefined ? null : loadPrincipal(db, row.principalId)
}

function markReviewed(db: Db, id: string): void {
  db.update(principal).set({ reviewedAt: new Date() }).where(eq(principal.id, id)).run()
}

function setDisplayName(db: Db, id: string, displayName: string): void {
  db.update(principal).set({ displayName }).where(eq(principal.id, id)).run()
}

function listRoles(db: Db): readonly RoleInfo[] {
  return db.select().from(role).all().map((r) => ({
    name: r.name,
    builtin: r.builtin,
    patterns: db.select({ pattern: roleCommand.pattern }).from(roleCommand)
      .where(eq(roleCommand.roleId, r.id)).all().map((p) => p.pattern),
  }))
}

function rolesOf(db: Db, principalId: string): readonly string[] {
  return db
    .select({ name: role.name })
    .from(principalRole)
    .innerJoin(role, eq(role.id, principalRole.roleId))
    .where(eq(principalRole.principalId, principalId))
    .all()
    .map((r) => r.name)
}

function findRole(db: Db, name: string): { id: string; builtin: boolean } | undefined {
  return db.select({ id: role.id, builtin: role.builtin }).from(role).where(eq(role.name, name)).get()
}

function assignRole(db: Db, principalId: string, roleName: string): void {
  const found = findRole(db, roleName)
  if (found === undefined) throw new Error(`role '${roleName}' does not exist`)
  db.insert(principalRole).values({ principalId, roleId: found.id }).onConflictDoNothing().run()
}

function revokeRole(db: Db, principalId: string, roleName: string): void {
  const found = findRole(db, roleName)
  if (found === undefined) throw new Error(`role '${roleName}' does not exist`)
  db.delete(principalRole)
    .where(and(eq(principalRole.principalId, principalId), eq(principalRole.roleId, found.id)))
    .run()
}

function createRole(db: Db, name: string, patterns: readonly string[]): void {
  const id = crypto.randomUUID()
  db.transaction((tx) => {
    tx.insert(role).values({ id, name }).run()
    for (const pattern of patterns) tx.insert(roleCommand).values({ roleId: id, pattern }).run()
  })
}

function setRoleCommands(db: Db, name: string, patterns: readonly string[]): void {
  const found = findRole(db, name)
  if (found === undefined) throw new Error(`role '${name}' does not exist`)
  if (found.builtin) throw new Error(`role '${name}' is builtin and cannot be rewritten`)
  db.transaction((tx) => {
    tx.delete(roleCommand).where(eq(roleCommand.roleId, found.id)).run()
    for (const pattern of patterns) tx.insert(roleCommand).values({ roleId: found.id, pattern }).run()
  })
}

function deleteRole(db: Db, name: string): void {
  const found = findRole(db, name)
  if (found === undefined) throw new Error(`role '${name}' does not exist`)
  if (found.builtin) throw new Error(`role '${name}' is builtin and cannot be deleted`)
  db.delete(role).where(eq(role.id, found.id)).run()
}

// Defers the call into .then() so a throwing driver rejects the returned promise
// instead of throwing synchronously out of what the published contract says is async.
function toPromise<T>(fn: () => T): Promise<T> {
  return Promise.resolve().then(fn)
}

/**
 * Mounts one key per granted scope onto a fresh object — never the full API with keys
 * deleted — so a plugin without a scope has no property to find, not a rejected call.
 */
export function createMyceliumApi(
  registry: Registry,
  scopes: readonly MyceliumScope[],
  send: (target: PushTarget, content: OutgoingContent) => Promise<void>,
  db: Db,
): object {
  const granted = new Set(scopes)
  // No prototype: a global Object.prototype pollution must not forge an absent scope
  // as present through `in`, which is exactly how a caller is expected to check.
  const api = Object.create(null) as Partial<
    PluginsRead & HealthRead & MessagesSend & PrincipalsRead & PrincipalsManage &
    RolesRead & RolesAssign & RolesManage
  >

  if (granted.has('plugins.read')) api.listPlugins = () => listPlugins(registry)
  if (granted.has('health.read')) api.health = () => aggregateHealth(registry)
  if (granted.has('messages.send')) api.send = send

  if (granted.has('principals.read')) {
    api.listPrincipals = () => toPromise(() => listPrincipals(db))
    api.getPrincipal = (id) => toPromise(() => loadPrincipal(db, id))
    api.findByIdentity = (channel, externalId) => toPromise(() => findByIdentity(db, channel, externalId))
  }
  if (granted.has('principals.manage')) {
    api.markReviewed = (id) => toPromise(() => markReviewed(db, id))
    api.setDisplayName = (id, name) => toPromise(() => setDisplayName(db, id, name))
  }
  if (granted.has('roles.read')) {
    api.listRoles = () => toPromise(() => listRoles(db))
    api.rolesOf = (id) => toPromise(() => rolesOf(db, id))
  }
  if (granted.has('roles.assign')) {
    api.assignRole = (p, r) => toPromise(() => assignRole(db, p, r))
    api.revokeRole = (p, r) => toPromise(() => revokeRole(db, p, r))
  }
  if (granted.has('roles.manage')) {
    api.createRole = (name, patterns) => toPromise(() => createRole(db, name, patterns))
    api.setRoleCommands = (name, patterns) => toPromise(() => setRoleCommands(db, name, patterns))
    api.deleteRole = (name) => toPromise(() => deleteRole(db, name))
  }

  return api
}
