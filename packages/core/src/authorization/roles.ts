import { and, eq } from 'drizzle-orm'
import type { RoleInfo } from '@mycelo/septum'
import { requirePrincipal } from '../identity/people.js'
import type { Db } from '../persistence/db.js'
import { principalRole, role, roleCommand } from '../persistence/schema.js'
import { StoreRefusal } from './refusal.js'

export function listRoles(db: Db): readonly RoleInfo[] {
  return db.select().from(role).all().map((r) => ({
    name: r.name,
    builtin: r.builtin,
    patterns: db.select({ pattern: roleCommand.pattern }).from(roleCommand)
      .where(eq(roleCommand.roleId, r.id)).all().map((p) => p.pattern),
  }))
}

export function findRole(db: Db, name: string): { id: string; builtin: boolean } | undefined {
  return db.select({ id: role.id, builtin: role.builtin }).from(role).where(eq(role.name, name)).get()
}

export function assignRole(db: Db, principalId: string, roleName: string): void {
  const found = findRole(db, roleName)
  if (found === undefined) throw new StoreRefusal('role-unknown', `role '${roleName}' does not exist`)
  requirePrincipal(db, principalId)
  db.insert(principalRole).values({ principalId, roleId: found.id }).onConflictDoNothing().run()
}

export function revokeRole(db: Db, principalId: string, roleName: string): void {
  const found = findRole(db, roleName)
  if (found === undefined) throw new StoreRefusal('role-unknown', `role '${roleName}' does not exist`)
  requirePrincipal(db, principalId)
  db.delete(principalRole)
    .where(and(eq(principalRole.principalId, principalId), eq(principalRole.roleId, found.id)))
    .run()
}

// Curated like its three siblings: the raw SQLite UNIQUE and primary-key violations
// reached the user as "command 'role-new' failed", naming nothing.
export function createRole(db: Db, name: string, patterns: readonly string[]): void {
  if (name === '') throw new StoreRefusal('role-name-empty', 'a role name cannot be empty')
  if (findRole(db, name) !== undefined) {
    throw new StoreRefusal('role-exists', `role '${name}' already exists`)
  }
  const duplicate = patterns.find((p, i) => patterns.indexOf(p) !== i)
  if (duplicate !== undefined) {
    throw new StoreRefusal('pattern-duplicate', `pattern '${duplicate}' is listed twice`)
  }
  const id = crypto.randomUUID()
  db.transaction((tx) => {
    tx.insert(role).values({ id, name }).run()
    for (const pattern of patterns) tx.insert(roleCommand).values({ roleId: id, pattern }).run()
  })
}

export function setRoleCommands(db: Db, name: string, patterns: readonly string[]): void {
  const found = findRole(db, name)
  if (found === undefined) throw new StoreRefusal('role-unknown', `role '${name}' does not exist`)
  if (found.builtin) {
    throw new StoreRefusal('role-builtin', `role '${name}' is builtin and cannot be rewritten`)
  }
  const duplicate = patterns.find((p, i) => patterns.indexOf(p) !== i)
  if (duplicate !== undefined) {
    throw new StoreRefusal('pattern-duplicate', `pattern '${duplicate}' is listed twice`)
  }
  db.transaction((tx) => {
    tx.delete(roleCommand).where(eq(roleCommand.roleId, found.id)).run()
    for (const pattern of patterns) tx.insert(roleCommand).values({ roleId: found.id, pattern }).run()
  })
}

export function deleteRole(db: Db, name: string, defaultRole?: string): void {
  const found = findRole(db, name)
  if (found === undefined) throw new StoreRefusal('role-unknown', `role '${name}' does not exist`)
  if (found.builtin) {
    throw new StoreRefusal('role-builtin', `role '${name}' is builtin and cannot be deleted`)
  }
  // Boot raises a StartupError for a missing defaultRole; deleting into that state would
  // leave every first contact throwing until someone restarts and sees why.
  if (defaultRole !== undefined && name === defaultRole) {
    throw new StoreRefusal(
      'role-is-default', `role '${name}' is the configured default role and cannot be deleted`,
    )
  }
  db.delete(role).where(eq(role.id, found.id)).run()
}
