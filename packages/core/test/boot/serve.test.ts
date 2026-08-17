import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
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

  it('returns a closeDb that actually closes the database', () => {
    const served = serve(config('spores: ./none\ndatabase: ./mycelo.db\n'))
    served.closeDb()
    expect(() => served.state.db.get<[number]>(sql`SELECT 1`)).toThrow()
  })
})
