import { describe, expect, it } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import { migrateDatabase, openDatabase } from '../../src/persistence/db.js'
import { channelIdentity, principal, principalRole, role, roleCommand } from '../../src/persistence/schema.js'

function fresh() {
  const persistence = openDatabase(':memory:')
  migrateDatabase(persistence.db)
  return persistence
}

describe('openDatabase', () => {
  it('creates the five tables from the committed migrations', () => {
    const { db, close } = fresh()
    const rows = db.all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
    close()
    const names = rows.map((r) => r.name)
    expect(names).toContain('principal')
    expect(names).toContain('channel_identity')
    expect(names).toContain('role')
    expect(names).toContain('role_command')
    expect(names).toContain('principal_role')
  })

  it('round-trips a principal with a timestamp and a null review date', () => {
    const { db, close } = fresh()
    const created = new Date(1_700_000_000_000)
    db.insert(principal).values({ id: 'p1', displayName: 'alice', createdAt: created }).run()
    const row = db.select().from(principal).where(eq(principal.id, 'p1')).get()
    close()
    expect(row?.createdAt).toBeInstanceOf(Date)
    expect(row?.createdAt.getTime()).toBe(1_700_000_000_000)
    expect(row?.reviewedAt).toBeNull()
  })

  it('stores builtin as a boolean, not as 0 and 1', () => {
    const { db, close } = fresh()
    db.insert(role).values({ id: 'r1', name: 'owner', builtin: true }).run()
    const row = db.select().from(role).where(eq(role.id, 'r1')).get()
    close()
    expect(row?.builtin).toBe(true)
  })

  it('enforces foreign keys, so an identity cannot name a principal that does not exist', () => {
    const { db, close } = fresh()
    expect(() =>
      db.insert(channelIdentity).values({
        channel: 'console', externalId: 'ghost', principalId: 'nobody', firstSeenAt: new Date(),
      }).run(),
    ).toThrow()
    close()
  })

  it('keys an identity on (channel, external_id), so the same handle on two channels is two rows', () => {
    const { db, close } = fresh()
    const now = new Date()
    db.insert(principal).values({ id: 'p1', createdAt: now }).run()
    db.insert(channelIdentity).values({ channel: 'console', externalId: 'alice', principalId: 'p1', firstSeenAt: now }).run()
    db.insert(channelIdentity).values({ channel: 'signal', externalId: 'alice', principalId: 'p1', firstSeenAt: now }).run()
    const rows = db.select().from(channelIdentity).all()
    close()
    expect(rows).toHaveLength(2)
  })

  it('cascades role deletion to its patterns and assignments', () => {
    const { db, close } = fresh()
    const now = new Date()
    db.insert(principal).values({ id: 'p1', createdAt: now }).run()
    db.insert(role).values({ id: 'r1', name: 'guest' }).run()
    db.insert(roleCommand).values({ roleId: 'r1', pattern: 'media.*' }).run()
    db.insert(principalRole).values({ principalId: 'p1', roleId: 'r1' }).run()
    db.delete(role).where(eq(role.id, 'r1')).run()
    const patterns = db.select().from(roleCommand).all()
    const assignments = db.select().from(principalRole).all()
    close()
    expect(patterns).toEqual([])
    expect(assignments).toEqual([])
  })
})
