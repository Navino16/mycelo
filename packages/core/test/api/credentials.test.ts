import { describe, expect, it, spyOn } from 'bun:test'
import {
  changePassword, deleteAllCredentials, hasCredential, insertCredential, verifyCredential,
} from '../../src/api/credentials.js'
import { migrateDatabase, openDatabase } from '../../src/persistence/db.js'
import { principal } from '../../src/persistence/schema.js'
import type { Db } from '../../src/persistence/db.js'

function fresh(): { db: Db, close: () => void } {
  const p = openDatabase(':memory:')
  migrateDatabase(p.db)
  return p
}

function person(db: Db, id: string): string {
  db.insert(principal).values({ id, createdAt: new Date() }).run()
  return id
}

/** What POST /api/setup does: hash, then insert. There is no src/ helper that pairs them. */
async function seedCredential(db: Db, id: string, username: string, password: string): Promise<void> {
  insertCredential(db, id, username, await Bun.password.hash(password))
}

describe('credentials', () => {
  it('reports none before the first is created', () => {
    const { db, close } = fresh()
    expect(hasCredential(db)).toBe(false)
    close()
  })

  it('verifies the right password and refuses the wrong one', async () => {
    const { db, close } = fresh()
    await seedCredential(db, person(db, 'p1'), 'alice', 'correct horse')
    expect(await verifyCredential(db, 'alice', 'correct horse')).toBe('p1')
    expect(await verifyCredential(db, 'alice', 'wrong horse')).toBeNull()
    expect(await verifyCredential(db, 'nobody', 'correct horse')).toBeNull()
    close()
  })

  it('changes a password only with the current one', async () => {
    const { db, close } = fresh()
    await seedCredential(db, person(db, 'p1'), 'alice', 'old')
    expect(changePassword(db, 'p1', 'wrong', 'new')).rejects.toThrow(/current password/)
    await changePassword(db, 'p1', 'old', 'new')
    expect(await verifyCredential(db, 'alice', 'new')).toBe('p1')
    expect(await verifyCredential(db, 'alice', 'old')).toBeNull()
    close()
  })

  // The dummy hash on the unknown-username path is what stops the login route being a
  // timing oracle for usernames (spec §6.1). Deleting it survived the whole suite
  // (campaign M10), because every other assertion here is on the return value alone.
  it('hashes anyway for an unknown username, so login is not a username oracle', async () => {
    const { db, close } = fresh()
    await seedCredential(db, person(db, 'p1'), 'alice', 'correct horse')
    const hash = spyOn(Bun.password, 'hash')
    try {
      expect(await verifyCredential(db, 'nobody', 'correct horse')).toBeNull()
      expect(hash).toHaveBeenCalledTimes(1)
    } finally {
      hash.mockRestore()
      close()
    }
  })

  it('deletes every credential and says how many', async () => {
    const { db, close } = fresh()
    await seedCredential(db, person(db, 'p1'), 'alice', 'pw')
    expect(deleteAllCredentials(db)).toBe(1)
    expect(hasCredential(db)).toBe(false)
    close()
  })
})
