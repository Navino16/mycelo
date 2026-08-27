import { eq } from 'drizzle-orm'
import type { SporangiumSource } from '@mycelo/septum'
import { REDACTED } from '../config/plugins.js'
import type { Db } from '../persistence/db.js'
import { source } from '../persistence/schema.js'

export const TOKEN_MASK = REDACTED

/** design §11: seeded, never operator-settable — the reviewed registry. */
const OFFICIAL = {
  label: 'Mycelo spores',
  driver: 'github' as const,
  location: 'https://github.com/Navino16/mycelo-spores',
}

type Row = typeof source.$inferSelect

function present(row: Row): SporangiumSource {
  const dto: SporangiumSource = {
    id: row.id,
    label: row.label,
    driver: row.driver,
    location: row.location,
    official: row.official,
    enabled: row.enabled,
  }
  if (row.token !== null && row.token !== '') dto.token = TOKEN_MASK
  return dto
}

export function seedOfficialSource(db: Db): void {
  if (db.select().from(source).where(eq(source.official, true)).all().length > 0) return
  db.insert(source).values({ ...OFFICIAL, official: true, enabled: true }).run()
}

export function listSources(db: Db): readonly SporangiumSource[] {
  return db.select().from(source).all().map(present)
}

export function getSource(db: Db, id: number): SporangiumSource | null {
  const row = db.select().from(source).where(eq(source.id, id)).get()
  return row === undefined ? null : present(row)
}

/** The raw token, for a driver. Never crosses the API boundary. */
export function sourceToken(db: Db, id: number): string | null {
  const row = db.select().from(source).where(eq(source.id, id)).get()
  if (row === undefined || row.token === null || row.token === '') return null
  return row.token
}

export function addSource(
  db: Db,
  s: { label: string, driver: 'local' | 'github', location: string, token?: string },
): SporangiumSource {
  // official is never taken from the caller (design §11).
  const row = db.insert(source)
    .values({ label: s.label, driver: s.driver, location: s.location, token: s.token ?? null, official: false, enabled: true })
    .returning()
    .get()
  return present(row)
}

export function updateSource(
  db: Db,
  id: number,
  patch: { label?: string, location?: string, token?: string, enabled?: boolean },
): SporangiumSource | null {
  if (db.select().from(source).where(eq(source.id, id)).get() === undefined) return null
  const values: Partial<Row> = {}
  if (patch.label !== undefined) values.label = patch.label
  if (patch.location !== undefined) values.location = patch.location
  if (patch.enabled !== undefined) values.enabled = patch.enabled
  // The mask is what a form reads back, so it is not a value: writing it keeps what is
  // stored, and an explicit empty string is the only way to clear a token.
  if (patch.token !== undefined && patch.token !== TOKEN_MASK) {
    values.token = patch.token === '' ? null : patch.token
  }
  const row = db.update(source).set(values).where(eq(source.id, id)).returning().get()
  return present(row)
}

/** False when the source is official: it can be disabled, never deleted (design §11). */
export function deleteSource(db: Db, id: number): boolean {
  const existing = db.select().from(source).where(eq(source.id, id)).get()
  if (existing === undefined || existing.official) return false
  db.delete(source).where(eq(source.id, id)).run()
  return true
}

/**
 * One row per configured local root, so the UI has something to render §7.4's "neither
 * versioned nor traceable" warning against. mycelo.yaml stays the authority.
 */
export function upsertLocalSource(db: Db, absolutePath: string): void {
  const held = db.select().from(source).where(eq(source.location, absolutePath)).all()
  if (held.some((r) => r.driver === 'local')) return
  db.insert(source)
    .values({ label: absolutePath, driver: 'local', location: absolutePath, token: null, official: false, enabled: true })
    .run()
}
