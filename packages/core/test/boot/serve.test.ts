import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { count, sql } from 'drizzle-orm'
import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { hasCredential, insertCredential } from '../../src/api/credentials.js'
import { openSession } from '../../src/api/sessions.js'
import { serve } from '../../src/boot/serve.js'
import { migrateDatabase, openDatabase } from '../../src/persistence/db.js'
import { principal, uiSession } from '../../src/persistence/schema.js'

let dir: string
let closeDb: (() => void) | undefined
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mycelo-serve-')) })
afterEach(() => { closeDb?.(); closeDb = undefined; rmSync(dir, { recursive: true, force: true }) })

function config(body: string): string {
  const file = join(dir, 'mycelo.yaml')
  writeFileSync(file, body, 'utf8')
  return file
}

describe('phase 1', () => {
  it('opens the database, migrates it and starts in starting', () => {
    const served = serve(config('spores: ./none\ndatabase: ./mycelo.db\n'))
    closeDb = served.closeDb
    expect(served.state.germination.status).toBe('starting')
    // A migrated database answers a schema query; an unmigrated one answers nothing.
    expect(served.state.db.get<[string]>(sql`SELECT name FROM sqlite_master WHERE name = 'principal'`)?.[0])
      .toBe('principal')
  })

  it('gives phase 1 a translator that renders a core key', () => {
    const served = serve(config('spores: ./none\ndatabase: ./mycelo.db\n'))
    closeDb = served.closeDb
    // Degraded mode renders its own diagnostics, so this must work before any spore
    // catalogue exists (spec §3).
    expect(served.state.translator.translate('core', 'command.unknown', 'en', { command: 'x' }))
      .not.toBe('command.unknown')
    expect(served.state.translator.availableLocales().length).toBeGreaterThan(0)
  })

  it('is fatal on an unknown defaultRole rather than degrading', () => {
    expect(() => serve(config('spores: ./none\ndatabase: ./d.db\ndefaultRole: ghost\n')))
      .toThrow(/defaultRole 'ghost'/)
  })

  it('returns a closeDb that refuses further queries', () => {
    const served = serve(config('spores: ./none\ndatabase: ./mycelo.db\n'))
    served.closeDb()
    expect(() => served.state.db.get<[number]>(sql`SELECT 1`)).toThrow()
  })

  it('closes the database when a step after openDatabase throws', () => {
    // Counted on the prototype rather than through the returned handle: a throw gives the
    // caller no `closeDb`, and bun:sqlite defers the OS-level release for as long as a
    // drizzle statement lives, so neither the fd nor the -wal file moves.
    // Read through the descriptor, not as `Database.prototype.close`: an unbound method
    // reference trips @typescript-eslint/unbound-method, and this project has no disables.
    type Close = (this: Database, throwOnError?: boolean) => void
    const original = Object.getOwnPropertyDescriptor(Database.prototype, 'close')?.value as Close
    let closes = 0
    Database.prototype.close = function counted(this: Database, throwOnError?: boolean): void {
      closes += 1
      original.call(this, throwOnError)
    }
    try {
      expect(() => serve(config('spores: ./none\ndatabase: ./d.db\ndefaultRole: ghost\n'))).toThrow()
    } finally {
      Database.prototype.close = original
    }
    expect(closes).toBe(1)
  })

  it('ui.resetAccount removes every UI credential and session', async () => {
    const databaseFile = join(dir, 'mycelo.db')
    const seed = openDatabase(databaseFile)
    migrateDatabase(seed.db)
    seed.db.insert(principal).values({ id: 'p1', createdAt: new Date() }).run()
    insertCredential(seed.db, 'p1', 'alice', await Bun.password.hash('secret'))
    openSession(seed.db, 'p1')
    seed.close()

    const served = serve(config('spores: ./none\ndatabase: ./mycelo.db\nui:\n  resetAccount: true\n'))
    closeDb = served.closeDb
    expect(hasCredential(served.state.db)).toBe(false)
    expect(served.state.db.select({ n: count() }).from(uiSession).get()?.n).toBe(0)
  })

  it('leaves every UI credential and session alone without ui.resetAccount', async () => {
    const databaseFile = join(dir, 'mycelo.db')
    const seed = openDatabase(databaseFile)
    migrateDatabase(seed.db)
    seed.db.insert(principal).values({ id: 'p1', createdAt: new Date() }).run()
    insertCredential(seed.db, 'p1', 'alice', await Bun.password.hash('secret'))
    openSession(seed.db, 'p1')
    seed.close()

    const served = serve(config('spores: ./none\ndatabase: ./mycelo.db\n'))
    closeDb = served.closeDb
    expect(hasCredential(served.state.db)).toBe(true)
    expect(served.state.db.select({ n: count() }).from(uiSession).get()?.n).toBe(1)
  })

  // sweepSessions() itself is covered by test/api/sessions.test.ts; the mutation that
  // survived was deleting its one call site here, leaving expired rows to accumulate
  // with no other reaper (campaign M37).
  it('sweeps expired sessions at boot and leaves the live ones', () => {
    const databaseFile = join(dir, 'mycelo.db')
    const seed = openDatabase(databaseFile)
    migrateDatabase(seed.db)
    seed.db.insert(principal).values({ id: 'p1', createdAt: new Date() }).run()
    const past = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    openSession(seed.db, 'p1')
    openSession(seed.db, 'p1', past)
    openSession(seed.db, 'p1', past)
    expect(seed.db.select({ n: count() }).from(uiSession).get()?.n).toBe(3)
    seed.close()

    const served = serve(config('spores: ./none\ndatabase: ./mycelo.db\n'))
    closeDb = served.closeDb
    // The plural case: two expired rows, so a sweep collapsed to one of them is caught.
    expect(served.state.db.select({ n: count() }).from(uiSession).get()?.n).toBe(1)
  })
})
