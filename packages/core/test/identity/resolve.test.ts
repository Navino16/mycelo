import { describe, expect, it } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import { migrateDatabase, openDatabase } from '../../src/persistence/db.js'
import type { Db } from '../../src/persistence/db.js'
import { channelIdentity, principal, principalRole, role, roleCommand } from '../../src/persistence/schema.js'
import { patternsOf, resolvePrincipal } from '../../src/identity/resolve.js'

function fresh(): Db {
  const { db } = openDatabase(':memory:')
  migrateDatabase(db)
  return db
}

function seedRole(db: Db, name: string, patterns: readonly string[]): string {
  const id = `r:${name}`
  db.insert(role).values({ id, name }).run()
  for (const pattern of patterns) db.insert(roleCommand).values({ roleId: id, pattern }).run()
  return id
}

// SQLite's own write counter: unlike reading a column back, it detects an UPDATE
// that changes no value, which the guard under test exists to avoid.
function totalChanges(db: Db): number {
  const row = db.get<[number]>(sql`SELECT total_changes()`)
  if (row === undefined) throw new Error('total_changes() returned nothing')
  return row[0]
}

describe('resolvePrincipal', () => {
  it('creates a principal on first contact and reports it as never reviewed', () => {
    const db = fresh()
    const p = resolvePrincipal(db, { channel: 'console', externalId: 'alice', displayName: 'alice' })
    expect(p.id).not.toBe('')
    expect(p.roles).toEqual([])
    const row = db.select().from(principal).where(eq(principal.id, p.id)).get()
    expect(row?.reviewedAt).toBeNull()
    expect(row?.displayName).toBe('alice')
  })

  it('returns the same principal on the second message rather than creating another', () => {
    const db = fresh()
    const first = resolvePrincipal(db, { channel: 'console', externalId: 'alice' })
    const second = resolvePrincipal(db, { channel: 'console', externalId: 'alice' })
    expect(second.id).toBe(first.id)
    expect(db.select().from(principal).all()).toHaveLength(1)
  })

  it('assigns the default role on first contact only', () => {
    const db = fresh()
    seedRole(db, 'guest', ['media.*'])
    const p = resolvePrincipal(db, { channel: 'console', externalId: 'bob' }, { defaultRole: 'guest' })
    expect(p.roles).toEqual(['guest'])
    db.delete(principalRole).where(eq(principalRole.principalId, p.id)).run()
    const again = resolvePrincipal(db, { channel: 'console', externalId: 'bob' }, { defaultRole: 'guest' })
    expect(again.roles).toEqual([])
  })

  it('creates a principal with no role when no default is configured', () => {
    const db = fresh()
    const p = resolvePrincipal(db, { channel: 'console', externalId: 'carol' })
    expect(p.roles).toEqual([])
  })

  it('reports every identity of the principal, not only the one speaking', () => {
    const db = fresh()
    const p = resolvePrincipal(db, { channel: 'console', externalId: 'alice' })
    db.insert(channelIdentity).values({
      channel: 'signal', externalId: '+3312', principalId: p.id, firstSeenAt: new Date(),
    }).run()
    const again = resolvePrincipal(db, { channel: 'console', externalId: 'alice' })
    expect(again.identities.map((i) => i.channel).sort()).toEqual(['console', 'signal'])
  })

  it('refreshes a changed display name', () => {
    const db = fresh()
    const p = resolvePrincipal(db, { channel: 'console', externalId: 'alice', displayName: 'alice' })
    resolvePrincipal(db, { channel: 'console', externalId: 'alice', displayName: 'Alice B' })
    const row = db.select().from(channelIdentity).where(eq(channelIdentity.externalId, 'alice')).get()
    expect(row?.displayName).toBe('Alice B')
    expect(resolvePrincipal(db, { channel: 'console', externalId: 'alice' }).id).toBe(p.id)
  })

  it('does not write when the display name is unchanged', () => {
    const db = fresh()
    resolvePrincipal(db, { channel: 'console', externalId: 'alice', displayName: 'alice' })
    const before = totalChanges(db)
    resolvePrincipal(db, { channel: 'console', externalId: 'alice', displayName: 'alice' })
    expect(totalChanges(db)).toBe(before)
  })

  it('writes exactly once when the display name changed', () => {
    const db = fresh()
    resolvePrincipal(db, { channel: 'console', externalId: 'alice', displayName: 'alice' })
    const before = totalChanges(db)
    resolvePrincipal(db, { channel: 'console', externalId: 'alice', displayName: 'Alice B' })
    expect(totalChanges(db)).toBe(before + 1)
  })

  it('treats the same handle on two channels as two principals', () => {
    const db = fresh()
    const a = resolvePrincipal(db, { channel: 'console', externalId: 'alice' })
    const b = resolvePrincipal(db, { channel: 'signal', externalId: 'alice' })
    expect(b.id).not.toBe(a.id)
  })

  it('rolls back the whole first contact when the default role does not exist', () => {
    const db = fresh()
    expect(() =>
      resolvePrincipal(db, { channel: 'console', externalId: 'dave' }, { defaultRole: 'ghost' }),
    ).toThrow()
    expect(db.select().from(principal).all()).toEqual([])
    expect(db.select().from(channelIdentity).all()).toEqual([])
  })
})

describe('patternsOf', () => {
  it('unions the patterns of every role the principal holds', () => {
    const db = fresh()
    seedRole(db, 'guest', ['media.*'])
    seedRole(db, 'helper', ['admin.plugins', 'media.*'])
    const p = resolvePrincipal(db, { channel: 'console', externalId: 'eve' })
    db.insert(principalRole).values({ principalId: p.id, roleId: 'r:guest' }).run()
    db.insert(principalRole).values({ principalId: p.id, roleId: 'r:helper' }).run()
    expect([...patternsOf(db, p.id)].sort()).toEqual(['admin.plugins', 'media.*', 'media.*'])
  })

  it('returns nothing for a principal with no role', () => {
    const db = fresh()
    const p = resolvePrincipal(db, { channel: 'console', externalId: 'frank' })
    expect(patternsOf(db, p.id)).toEqual([])
  })
})
