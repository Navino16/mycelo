import { and, eq, lt, ne } from 'drizzle-orm'
import type { Db } from '../persistence/db.js'
import { uiSession } from '../persistence/schema.js'

export const SESSION_COOKIE = 'mycelo_session'

/** Sliding, so an operator who uses the UI daily never has to log in again (spec §6.2). */
const LIFETIME_MS = 14 * 24 * 60 * 60 * 1000

function hash(token: string): string {
  return new Bun.CryptoHasher('sha256').update(token).digest('hex')
}

/** The only moment the plaintext token exists; nothing persists it. */
export function openSession(db: Db, principalId: string, now = new Date()): string {
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')
  db.insert(uiSession).values({
    tokenHash: hash(token),
    principalId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + LIFETIME_MS),
    lastSeenAt: now,
  }).run()
  return token
}

export function readSession(db: Db, token: string, now = new Date()): string | null {
  const tokenHash = hash(token)
  const row = db
    .select({ principalId: uiSession.principalId, expiresAt: uiSession.expiresAt })
    .from(uiSession)
    .where(eq(uiSession.tokenHash, tokenHash))
    .get()
  if (row === undefined) return null
  if (row.expiresAt.getTime() <= now.getTime()) {
    db.delete(uiSession).where(eq(uiSession.tokenHash, tokenHash)).run()
    return null
  }
  db.update(uiSession)
    .set({ lastSeenAt: now, expiresAt: new Date(now.getTime() + LIFETIME_MS) })
    .where(eq(uiSession.tokenHash, tokenHash))
    .run()
  return row.principalId
}

export function closeSession(db: Db, token: string): void {
  db.delete(uiSession).where(eq(uiSession.tokenHash, hash(token))).run()
}

/**
 * Called after a password change (spec §6 rulings): every *other* session for the
 * principal dies, so a stolen cookie does not survive the fix. `exceptToken` keeps the
 * caller's own session alive — only the route layer knows which token that is.
 */
export function closeSessionsFor(db: Db, principalId: string, exceptToken?: string): void {
  const own = eq(uiSession.principalId, principalId)
  const condition = exceptToken === undefined ? own : and(own, ne(uiSession.tokenHash, hash(exceptToken)))
  db.delete(uiSession).where(condition).run()
}

export function sweepSessions(db: Db, now = new Date()): number {
  const doomed = db.select({ tokenHash: uiSession.tokenHash }).from(uiSession)
    .where(lt(uiSession.expiresAt, now)).all()
  if (doomed.length > 0) db.delete(uiSession).where(lt(uiSession.expiresAt, now)).run()
  return doomed.length
}
