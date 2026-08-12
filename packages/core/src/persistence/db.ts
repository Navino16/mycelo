import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { fileURLToPath } from 'node:url'
import * as schema from './schema.js'

export type Db = BunSQLiteDatabase<typeof schema>

export interface Persistence {
  db: Db
  // Arrow-typed, not method shorthand: callers destructure `close` and call it detached
  // from the object, which method syntax flags under @typescript-eslint/unbound-method.
  close: () => void
}

export class DatabaseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DatabaseError'
  }
}

export function openDatabase(file: string): Persistence {
  let sqlite: Database
  try {
    sqlite = new Database(file, { create: true, strict: true })
    sqlite.exec('PRAGMA journal_mode = WAL')
    sqlite.exec('PRAGMA foreign_keys = ON')
  } catch (e) {
    throw new DatabaseError(`cannot open the database at '${file}': ${(e as Error).message}`)
  }
  return { db: drizzle(sqlite, { schema }), close: () => { sqlite.close() } }
}

// Resolved from this module, never from cwd: the migrator reads the folder off disk and
// `bun test` runs from the workspace root.
const MIGRATIONS = fileURLToPath(new URL('../../migrations', import.meta.url))

export function migrateDatabase(db: Db): void {
  try {
    migrate(db, { migrationsFolder: MIGRATIONS })
  } catch (e) {
    throw new DatabaseError(`migration failed: ${(e as Error).message}`)
  }
}
