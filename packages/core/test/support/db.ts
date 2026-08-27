import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import type { Db } from '../../src/persistence/db.js'
import { migrateDatabase } from '../../src/persistence/db.js'

/** A migrated in-memory database, fresh per call — the idiom every test in this suite uses. */
export function freshDb(): { db: Db } {
  const db = drizzle(new Database(':memory:')) as unknown as Db
  migrateDatabase(db)
  return { db }
}
