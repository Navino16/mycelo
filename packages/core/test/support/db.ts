import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import type { Db } from '../../src/persistence/db.js'
import { migrateDatabase } from '../../src/persistence/db.js'

// Mirrors openDatabase (src/persistence/db.ts): strict mode and foreign keys ON, so a
// constraint violation surfaces here exactly as it would in production. WAL is meaningless
// for `:memory:` and is skipped.
export function freshDb(): { db: Db } {
  const sqlite = new Database(':memory:', { create: true, strict: true })
  sqlite.exec('PRAGMA foreign_keys = ON')
  const db = drizzle(sqlite) as unknown as Db
  migrateDatabase(db)
  return { db }
}
