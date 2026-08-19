import { eq } from 'drizzle-orm'
import type { Db } from '../persistence/db.js'
import { uiCredential } from '../persistence/schema.js'

export function hasCredential(db: Db): boolean {
  return db.select({ id: uiCredential.principalId }).from(uiCredential).get() !== undefined
}

/**
 * Assumes the hash is already computed. Used by the setup route inside a `db.transaction`,
 * which on bun:sqlite runs its callback synchronously — nothing here may `await`.
 */
export function insertCredential(db: Db, principalId: string, username: string, passwordHash: string): void {
  db.insert(uiCredential)
    .values({ principalId, username, passwordHash, createdAt: new Date() })
    .run()
}

export async function verifyCredential(db: Db, username: string, password: string): Promise<string | null> {
  const row = db
    .select({ principalId: uiCredential.principalId, passwordHash: uiCredential.passwordHash })
    .from(uiCredential)
    .where(eq(uiCredential.username, username))
    .get()
  // Hash anyway for an unknown username, so a missing account and a wrong password take
  // comparable time and the login route does not become a username oracle.
  if (row === undefined) {
    await Bun.password.hash(password)
    return null
  }
  if (!await Bun.password.verify(password, row.passwordHash)) return null
  db.update(uiCredential).set({ lastLoginAt: new Date() })
    .where(eq(uiCredential.principalId, row.principalId)).run()
  return row.principalId
}

export async function changePassword(
  db: Db, principalId: string, current: string, next: string,
): Promise<void> {
  const row = db.select({ passwordHash: uiCredential.passwordHash }).from(uiCredential)
    .where(eq(uiCredential.principalId, principalId)).get()
  if (row === undefined) throw new Error('no UI account exists for this principal')
  if (!await Bun.password.verify(current, row.passwordHash)) {
    throw new Error('the current password is wrong')
  }
  db.update(uiCredential).set({ passwordHash: await Bun.password.hash(next) })
    .where(eq(uiCredential.principalId, principalId)).run()
}

/** For `ui.resetAccount` (spec §6.6): the only reason this table has a delete path. */
export function deleteAllCredentials(db: Db): number {
  const rows = db.select({ id: uiCredential.principalId }).from(uiCredential).all()
  if (rows.length > 0) db.delete(uiCredential).run()
  return rows.length
}
