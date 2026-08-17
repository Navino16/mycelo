import { and, eq } from 'drizzle-orm'
import type { Principal } from '@mycelo/septum'
import type { Db } from '../persistence/db.js'
import { channelIdentity, principal, principalRole, role } from '../persistence/schema.js'

export function loadPrincipal(db: Db, principalId: string): Principal | null {
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

export function listPrincipals(db: Db): readonly Principal[] {
  return db.select({ id: principal.id }).from(principal).all().map((r) => {
    const p = loadPrincipal(db, r.id)
    if (p === null) throw new Error(`principal '${r.id}' vanished mid-listing`)
    return p
  })
}

export function findByIdentity(db: Db, channel: string, externalId: string): Principal | null {
  const row = db
    .select({ principalId: channelIdentity.principalId })
    .from(channelIdentity)
    .where(and(eq(channelIdentity.channel, channel), eq(channelIdentity.externalId, externalId)))
    .get()
  return row === undefined ? null : loadPrincipal(db, row.principalId)
}

// An UPDATE matching no row is not an error in SQL, but it is a caller mistake here: the
// published contract says these reject rather than resolve for an id nobody holds.
export function requirePrincipal(db: Db, id: string): void {
  const row = db.select({ id: principal.id }).from(principal).where(eq(principal.id, id)).get()
  if (row === undefined) throw new Error(`principal '${id}' does not exist`)
}

export function markReviewed(db: Db, id: string): void {
  requirePrincipal(db, id)
  db.update(principal).set({ reviewedAt: new Date() }).where(eq(principal.id, id)).run()
}

export function setDisplayName(db: Db, id: string, displayName: string): void {
  requirePrincipal(db, id)
  db.update(principal).set({ displayName }).where(eq(principal.id, id)).run()
}

export function rolesOf(db: Db, principalId: string): readonly string[] {
  return db
    .select({ name: role.name })
    .from(principalRole)
    .innerJoin(role, eq(role.id, principalRole.roleId))
    .where(eq(principalRole.principalId, principalId))
    .all()
    .map((r) => r.name)
}
