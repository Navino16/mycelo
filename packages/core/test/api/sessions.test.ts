import { count } from 'drizzle-orm'
import { describe, expect, it } from 'bun:test'
import { closeSession, openSession, readSession, sweepSessions } from '../../src/api/sessions.js'
import { migrateDatabase, openDatabase } from '../../src/persistence/db.js'
import { principal, uiSession } from '../../src/persistence/schema.js'
import type { Db } from '../../src/persistence/db.js'

function fresh(): { db: Db, close: () => void } {
  const p = openDatabase(':memory:')
  migrateDatabase(p.db)
  p.db.insert(principal).values({ id: 'p1', createdAt: new Date() }).run()
  p.db.insert(principal).values({ id: 'p2', createdAt: new Date() }).run()
  return p
}

describe('sessions', () => {
  it('resolves the principal of a token it issued', () => {
    const { db, close } = fresh()
    expect(readSession(db, openSession(db, 'p1'))).toBe('p1')
    close()
  })

  it('stores the hash, so the stored value is not a usable token', () => {
    const { db, close } = fresh()
    const token = openSession(db, 'p1')
    const stored = db.select({ hash: uiSession.tokenHash }).from(uiSession).get()?.hash ?? ''
    expect(stored).not.toBe(token)
    // The stored value replayed as a cookie must not authenticate anyone (spec §6.2).
    expect(readSession(db, stored)).toBeNull()
    close()
  })

  it('refuses an unknown token', () => {
    const { db, close } = fresh()
    expect(readSession(db, 'not-a-token')).toBeNull()
    close()
  })

  it('refuses an expired token and removes it', () => {
    const { db, close } = fresh()
    const token = openSession(db, 'p1', new Date('2026-01-01T00:00:00Z'))
    expect(readSession(db, token, new Date('2026-03-01T00:00:00Z'))).toBeNull()
    // The row is gone, not merely refused: an expired session must not accumulate.
    expect(db.select({ n: count() }).from(uiSession).get()?.n).toBe(0)
    close()
  })

  it('slides the expiry forward on use', () => {
    const { db, close } = fresh()
    const token = openSession(db, 'p1', new Date('2026-01-01T00:00:00Z'))
    const expiry = (): number =>
      db.select({ at: uiSession.expiresAt }).from(uiSession).get()?.at.getTime() ?? 0
    const before = expiry()
    readSession(db, token, new Date('2026-01-05T00:00:00Z'))
    expect(expiry()).toBeGreaterThan(before)
    close()
  })

  it('closes one session without touching the others', () => {
    const { db, close } = fresh()
    const a = openSession(db, 'p1')
    const b = openSession(db, 'p2')
    closeSession(db, a)
    expect(readSession(db, a)).toBeNull()
    // The plural case: a DELETE that lost its WHERE clause would pass with one session.
    expect(readSession(db, b)).toBe('p2')
    close()
  })

  it('sweeps every expired session and keeps every live one', () => {
    const { db, close } = fresh()
    openSession(db, 'p1', new Date('2026-01-01T00:00:00Z'))
    openSession(db, 'p2', new Date('2026-01-01T00:00:00Z'))
    const live = openSession(db, 'p1', new Date('2026-03-01T00:00:00Z'))
    expect(sweepSessions(db, new Date('2026-03-02T00:00:00Z'))).toBe(2)
    expect(readSession(db, live, new Date('2026-03-02T00:00:00Z'))).toBe('p1')
    close()
  })
})
