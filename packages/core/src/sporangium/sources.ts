import { eq } from 'drizzle-orm'
import type { SporangiumSource } from '@mycelo/septum'
import type { Db } from '../persistence/db.js'
import { pluginInstall, source } from '../persistence/schema.js'
import { REDACTED, redactCredentials } from '../support/redaction.js'

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
    // Belt and braces: addSource and updateSource already strip a userinfo credential at
    // write, so this only covers a row no writer of this module produced.
    location: redactCredentials(row.location),
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

/** The raw location, userinfo included, for a driver. Never crosses the API boundary. */
export function sourceLocation(db: Db, id: number): string | null {
  return db.select().from(source).where(eq(source.id, id)).get()?.location ?? null
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
  // design §7: a local root is declared in mycelo.yaml and mirrored at boot, so a row added
  // here would be a phantom nothing manages. Refused in the store, like `official` below,
  // because the mycelium mounts this function too.
  if (s.driver === 'local') throw new Error('a local spores directory is declared in mycelo.yaml, not added as a source')
  // Stripped at write, not only on read: no driver path reads a location's userinfo, so a
  // credential put there authenticates nothing and would sit stored in the clear forever.
  // official is never taken from the caller (design §11).
  const row = db.insert(source)
    .values({ label: s.label, driver: s.driver, location: redactCredentials(s.location), token: s.token || null, official: false, enabled: true })
    .returning()
    .get()
  return present(row)
}

export function updateSource(
  db: Db,
  id: number,
  patch: { label?: string, location?: string, token?: string, enabled?: boolean },
): SporangiumSource | null {
  const existing = db.select().from(source).where(eq(source.id, id)).get()
  if (existing === undefined) return null
  const values: Partial<Row> = {}
  if (patch.label !== undefined) values.label = patch.label
  // Repointing the official row relabels an unreviewed sporangium as reviewed, and
  // inoculate keys its trust warning off `official` — strictly worse than the deletion
  // design §11 already forbids. Disabling and re-tokening it stay open.
  if (patch.location !== undefined && !existing.official) values.location = redactCredentials(patch.location)
  if (patch.enabled !== undefined) values.enabled = patch.enabled
  // The mask is what a form reads back, so it is not a value: writing it keeps what is
  // stored, and an explicit empty string is the only way to clear a token.
  if (patch.token !== undefined && patch.token !== TOKEN_MASK) {
    values.token = patch.token === '' ? null : patch.token
  }
  // A patch that changes nothing (e.g. the mask round-tripped alone) must not reach
  // drizzle's `set({})`, which throws rather than being a no-op.
  if (Object.keys(values).length === 0) return present(existing)
  const row = db.update(source).set(values).where(eq(source.id, id)).returning().get()
  return present(row)
}

/** The spores still installed from a source, by name. A non-empty answer blocks deletion. */
export function installsFromSource(db: Db, id: number): readonly string[] {
  return db.select().from(pluginInstall).where(eq(pluginInstall.sourceId, id)).all()
    .map((row) => row.name)
    .sort((a, b) => a.localeCompare(b))
}

/**
 * False when the source is official (design §11) and when a spore is still installed from
 * it: deleting the row would erase that spore's provenance. A caller separates the three
 * causes with getSource, .official and installsFromSource.
 */
export function deleteSource(db: Db, id: number): boolean {
  const existing = db.select().from(source).where(eq(source.id, id)).get()
  if (existing === undefined || existing.official) return false
  if (installsFromSource(db, id).length > 0) return false
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
