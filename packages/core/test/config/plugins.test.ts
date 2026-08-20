import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'bun:test'
import { recordInstall } from '../../src/config/store.js'
import { rejectedSettings } from '../../src/config/plugins.js'
import type { Db } from '../../src/persistence/db.js'
import { migrateDatabase, openDatabase } from '../../src/persistence/db.js'

const SPORES = [resolve(import.meta.dirname, '../../../../fixtures')]

function fresh(): { db: Db, close: () => void } {
  const p = openDatabase(':memory:')
  migrateDatabase(p.db)
  return p
}

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mycelo-config-plugins-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

// design §5.2's own worked example: fixtures/gate's error was a bare string, so
// objectRejections' `member(result.error, 'issues')` found nothing and the value passed
// through unvalidated. This is the defect ConfigError's guaranteed shape closes.
it('a rejected value is reported once the schema carries a declared issue', async () => {
  const { db, close } = fresh()
  recordInstall(db, 'gate', 'inhibitor')
  const rejected = await rejectedSettings(db, SPORES, 'gate', { channel: '' })
  expect(rejected).toEqual([{ key: 'channel', issues: [{ path: ['channel'], message: "gate config needs a non-empty 'channel'" }] }])
  close()
})

// Duck-typed like the fixtures in lifecycle.test.ts: a spore in a temporary directory
// cannot resolve the workspace's zod, and a real one carries its own copy anyway.
function handwritten(): void {
  mkdirSync(join(dir, 'handwritten', 'src'), { recursive: true })
  writeFileSync(
    join(dir, 'handwritten', 'spore.yaml'),
    'kind: enzyme\nname: handwritten\nseptum: "^0.8"\n'
      + 'commands:\n  - name: handwritten\n    description: x\n    code: handleIt\n',
    'utf8',
  )
  writeFileSync(
    join(dir, 'handwritten', 'src/index.ts'),
    'export default {\n'
      + '  configSchema: {\n'
      + '    safeParse: (input) => (typeof input?.port === "number"\n'
      + '      ? { success: true, data: input }\n'
      + '      : { success: false, error: { issues: [{ path: ["port"], message: "expected a number" }] } }),\n'
      + '  },\n'
      + '  create: () => ({ handlers: { handleIt: async () => {} } }),\n'
      + '}\n',
    'utf8',
  )
}

// No `shape`: pins that the whole-object fallback alone is now the mechanism, with no
// duck-typed per-field branch left to fall back on.
it('a hand-written ConfigSchema with no shape still gets per-value validation', async () => {
  const { db, close } = fresh()
  handwritten()
  recordInstall(db, 'handwritten', 'enzyme')
  const rejected = await rejectedSettings(db, [dir], 'handwritten', { port: 'nope' })
  expect(rejected).toEqual([{ key: 'port', issues: [{ path: ['port'], message: 'expected a number' }] }])
  close()
})
