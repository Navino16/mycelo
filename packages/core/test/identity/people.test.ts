import { describe, expect, it } from 'bun:test'
import { markReviewed, searchPrincipals } from '../../src/identity/people.js'
import { migrateDatabase, openDatabase } from '../../src/persistence/db.js'
import { channelIdentity, principal } from '../../src/persistence/schema.js'
import type { Db } from '../../src/persistence/db.js'

function fresh(): { db: Db, close: () => void } {
  const p = openDatabase(':memory:')
  migrateDatabase(p.db)
  return p
}

/** createdAt derived from the id's digits, so orderBy is deterministic across fixtures. */
function person(db: Db, id: string, displayName: string): void {
  const rank = Number(id.replace(/\D/g, '') || '0')
  db.insert(principal)
    .values({ id, displayName, createdAt: new Date(Date.parse('2026-01-01T00:00:00Z') + rank) })
    .run()
}

function identity(db: Db, principalId: string, channel: string, externalId: string): void {
  db.insert(channelIdentity)
    .values({ channel, externalId, principalId, firstSeenAt: new Date() })
    .run()
}

describe('searchPrincipals', () => {
  it('paginates and reports the true total, not the page length', () => {
    const { db, close } = fresh()
    for (let i = 0; i < 7; i++) person(db, `p${String(i)}`, `Person ${String(i)}`)
    const page = searchPrincipals(db, { page: 1, perPage: 3 })
    expect(page.items).toHaveLength(3)
    expect(page.total).toBe(7)
    close()
  })

  it('serves the second page, and it does not repeat the first', () => {
    const { db, close } = fresh()
    for (let i = 0; i < 5; i++) person(db, `p${String(i)}`, `Person ${String(i)}`)
    const first = searchPrincipals(db, { page: 1, perPage: 2 }).items.map((p) => p.id)
    const second = searchPrincipals(db, { page: 2, perPage: 2 }).items.map((p) => p.id)
    // An OFFSET computed as `page * perPage` instead of `(page - 1) * perPage` skips a
    // whole page and would still pass a single-page fixture.
    expect(second).not.toEqual(first)
    expect(second).toHaveLength(2)
    close()
  })

  // Campaign M45: dropping the `principal.id` tiebreaker from the ORDER BY. Every other
  // fixture here derives createdAt from the id, so no two rows ever tie and the tiebreaker
  // is unreachable. Inserted in reverse id order on one shared timestamp, bun:sqlite answers
  // p3,p2,p1 without it and p1,p2,p3 with it.
  it('orders principals sharing a createdAt by id, so page 2 cannot repeat page 1', () => {
    const { db, close } = fresh()
    const sameInstant = new Date('2026-01-01T00:00:00Z')
    for (const id of ['p3', 'p2', 'p1']) {
      db.insert(principal).values({ id, displayName: id, createdAt: sameInstant }).run()
    }
    expect(searchPrincipals(db, { page: 1, perPage: 3 }).items.map((p) => p.id))
      .toEqual(['p1', 'p2', 'p3'])
    // And the property the tiebreaker exists for, read across the page boundary.
    const first = searchPrincipals(db, { page: 1, perPage: 2 }).items.map((p) => p.id)
    const second = searchPrincipals(db, { page: 2, perPage: 2 }).items.map((p) => p.id)
    expect(first).toEqual(['p1', 'p2'])
    expect(second).toEqual(['p3'])
    close()
  })

  it('matches on a display name and on a channel external id', () => {
    const { db, close } = fresh()
    person(db, 'p1', 'Alice')
    identity(db, 'p1', 'console', 'alice-42')
    person(db, 'p2', 'Bob')
    expect(searchPrincipals(db, { page: 1, perPage: 10, search: 'ali' }).items.map((p) => p.id))
      .toEqual(['p1'])
    // A person is one person across identities (UI brief §9), so the search must reach them.
    expect(searchPrincipals(db, { page: 1, perPage: 10, search: '42' }).items.map((p) => p.id))
      .toEqual(['p1'])
    close()
  })

  it('finds nobody when the search term matches no display name and no identity', () => {
    const { db, close } = fresh()
    person(db, 'p1', 'Alice')
    identity(db, 'p1', 'console', 'alice-42')
    expect(searchPrincipals(db, { page: 1, perPage: 10, search: 'zzz' }).items).toEqual([])
    close()
  })

  it('filters the never-reviewed, and returns the others when asked', () => {
    const { db, close } = fresh()
    person(db, 'p1', 'Alice'); person(db, 'p2', 'Bob')
    markReviewed(db, 'p1')
    expect(searchPrincipals(db, { page: 1, perPage: 10, reviewed: false }).items.map((p) => p.id))
      .toEqual(['p2'])
    // Both directions: a predicate that ignored the flag would pass the first assertion
    // alone whenever the fixture happened to have one of each.
    expect(searchPrincipals(db, { page: 1, perPage: 10, reviewed: true }).items.map((p) => p.id))
      .toEqual(['p1'])
    close()
  })
})
