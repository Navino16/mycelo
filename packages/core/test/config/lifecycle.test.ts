import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'bun:test'
import { getInstall, recordInstall, setEnabled, writeSetting } from '../../src/config/store.js'
import { enablePlugin, syncInstalls } from '../../src/config/lifecycle.js'
import { germinate } from '../../src/germination/germinate.js'
import { migrateDatabase, openDatabase } from '../../src/persistence/db.js'
import { createLogger } from '../../src/support/logger.js'

const SPORES = resolve(import.meta.dirname, '../../../../fixtures')

function fresh(): { db: ReturnType<typeof openDatabase>['db'], close: () => void } {
  const p = openDatabase(':memory:')
  migrateDatabase(p.db)
  return p
}

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mycelo-lifecycle-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

function spore(name: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const file = join(dir, name, rel)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, content, 'utf8')
  }
}

// Duck-typed like confrhiza in germinate.test.ts: a spore in a temporary directory
// cannot resolve the workspace's zod, and a real one carries its own copy anyway.
const NEEDS_CONFIG_MODULE = `
  export default {
    configSchema: { safeParse: (input) => {
      const url = input === null || typeof input !== 'object' ? undefined : input.url
      return typeof url === 'string' && url.length > 0
        ? { success: true, data: { url } }
        : { success: false, error: "'url' must be a non-empty string" }
    } },
    create: () => ({
      handlers: {
        handleConfigured: async (_i, ctx) => { await ctx.reply({ text: 'configured with ' + ctx.config.url }) },
      },
    }),
  }
`

function needsConfig(): void {
  spore('needs-config', {
    'spore.yaml': 'kind: enzyme\nname: needs-config\nseptum: "^0.6"\n'
      + 'commands:\n  - name: configured\n    description: Report the configured url\n    code: handleConfigured\n',
    'src/index.ts': NEEDS_CONFIG_MODULE,
  })
}

it('the first sync enables what is already on disk', () => {
  const { db, close } = fresh()
  const { added } = syncInstalls(db, SPORES)
  expect(added).toContain('ping')
  // Nothing could be enabled otherwise: /plugin-enable lives in `admin`, disabled too.
  expect(getInstall(db, 'ping')?.enabled).toBe(true)
  close()
})

it('a spore appearing after the first sync arrives disabled', () => {
  const { db, close } = fresh()
  syncInstalls(db, SPORES)
  needsConfig()
  syncInstalls(db, dir)
  expect(getInstall(db, 'needs-config')?.enabled).toBe(false)
  close()
})

it('sync never revives a plugin the operator disabled', () => {
  const { db, close } = fresh()
  syncInstalls(db, SPORES)
  setEnabled(db, 'ping', false)
  syncInstalls(db, SPORES)
  // recordInstall uses onConflictDoNothing; an upsert here would undo the operator.
  expect(getInstall(db, 'ping')?.enabled).toBe(false)
  close()
})

it('sync leaves the row of a spore that has disappeared from disk', () => {
  const { db, close } = fresh()
  needsConfig()
  syncInstalls(db, dir)
  rmSync(join(dir, 'needs-config'), { recursive: true, force: true })
  syncInstalls(db, dir)
  expect(getInstall(db, 'needs-config')).not.toBeNull()
  close()
})

it('enabling refuses while a required setting is missing, and names the path', async () => {
  const { db, close } = fresh()
  needsConfig()
  recordInstall(db, 'needs-config', 'enzyme')
  const result = await enablePlugin(db, dir, 'needs-config')
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.reason).toContain('url')
  expect(getInstall(db, 'needs-config')?.enabled).toBe(false)
  close()
})

it('enabling succeeds once the setting is filled', async () => {
  const { db, close } = fresh()
  needsConfig()
  recordInstall(db, 'needs-config', 'enzyme')
  writeSetting(db, 'needs-config', 'url', 'http://x', false)
  const result = await enablePlugin(db, dir, 'needs-config')
  expect(result.ok).toBe(true)
  expect(getInstall(db, 'needs-config')?.enabled).toBe(true)
  close()
})

it('enabling refuses a plugin that is not installed', async () => {
  const { db, close } = fresh()
  needsConfig()
  const result = await enablePlugin(db, dir, 'needs-config')
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.reason).toContain('not installed')
  close()
})

it('enabling refuses a plugin whose directory is absent from disk', async () => {
  const { db, close } = fresh()
  recordInstall(db, 'ghost', 'enzyme')
  const result = await enablePlugin(db, dir, 'ghost')
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.reason).toContain('present on disk')
  expect(getInstall(db, 'ghost')?.enabled).toBe(false)
  close()
})

it('a disabled plugin does not germinate', async () => {
  // Guards the whole point of the flag: without this, `enabled` is decoration.
  const { db, close } = fresh()
  syncInstalls(db, SPORES)
  setEnabled(db, 'ping', false)
  const registry = await germinate(SPORES, createLogger(), {}, db)
  expect(registry.enzymes.map((e) => e.name)).not.toContain('ping')
  close()
})

it('a disabled plugin is skipped silently, never reported dormant', async () => {
  const { db, close } = fresh()
  syncInstalls(db, SPORES)
  setEnabled(db, 'ping', false)
  const registry = await germinate(SPORES, createLogger(), {}, db)
  // dormant is rendered as breakage by the UI; a disabled plugin is a choice.
  expect(registry.dormant.map((d) => d.name)).not.toContain('ping')
  close()
})

it('a spore with no install row at all does not germinate either', async () => {
  const { db, close } = fresh()
  const registry = await germinate(SPORES, createLogger(), {}, db)
  expect(registry.enzymes).toEqual([])
  expect(registry.hyphae).toEqual([])
  expect(registry.dormant).toEqual([])
  close()
})

it('germinate without a db ignores the install table entirely', async () => {
  const { db, close } = fresh()
  syncInstalls(db, SPORES)
  setEnabled(db, 'ping', false)
  const registry = await germinate(SPORES, createLogger(), {})
  expect(registry.enzymes.map((e) => e.name)).toContain('ping')
  close()
})
