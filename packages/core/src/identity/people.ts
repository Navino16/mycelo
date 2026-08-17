import { and, count, eq, inArray, isNotNull, isNull, like, or } from 'drizzle-orm'
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

export interface PeopleQuery {
  page: number
  perPage: number
  search?: string
  reviewed?: boolean
}

export interface PeoplePage {
  items: readonly Principal[]
  total: number
  page: number
  perPage: number
}

/** A person is one principal across several channel identities (spec §5.4, UI brief §9). */
export function searchPrincipals(db: Db, query: PeopleQuery): PeoplePage {
  const conditions = []
  if (query.search !== undefined && query.search !== '') {
    const needle = `%${query.search}%`
    // Two queries, not a raw sql subquery (task-13 brief): matches on either the
    // channel's own display name or its external id.
    const matchingIds = db.select({ principalId: channelIdentity.principalId }).from(channelIdentity)
      .where(or(like(channelIdentity.externalId, needle), like(channelIdentity.displayName, needle)))
      .all().map((r) => r.principalId)
    conditions.push(or(like(principal.displayName, needle), inArray(principal.id, matchingIds)))
  }
  if (query.reviewed === true) conditions.push(isNotNull(principal.reviewedAt))
  if (query.reviewed === false) conditions.push(isNull(principal.reviewedAt))
  const where = conditions.length === 0 ? undefined : and(...conditions)

  const total = db.select({ n: count() }).from(principal).where(where).get()?.n ?? 0
  const rows = db.select({ id: principal.id }).from(principal).where(where)
    // (createdAt, id): two principals created in the same millisecond would otherwise
    // order non-deterministically, and page 2 could repeat a row from page 1.
    .orderBy(principal.createdAt, principal.id)
    .limit(query.perPage)
    .offset((query.page - 1) * query.perPage)
    .all()
  const items = rows.map((r) => {
    const p = loadPrincipal(db, r.id)
    if (p === null) throw new Error(`principal '${r.id}' vanished mid-listing`)
    return p
  })
  return { items, total, page: query.page, perPage: query.perPage }
}
