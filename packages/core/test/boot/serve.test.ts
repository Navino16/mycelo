import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { serve } from '../../src/boot/serve.js'

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
})
