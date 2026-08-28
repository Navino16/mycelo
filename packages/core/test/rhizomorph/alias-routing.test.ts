import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'bun:test'
import { recordInstall, setEnabled } from '../../src/config/store.js'
import { germinate } from '../../src/germination/germinate.js'
import { bootstrap } from '../../src/mycelium.js'
import { migrateDatabase, openDatabase } from '../../src/persistence/db.js'
import { listPlugins } from '../../src/config/plugins.js'
import { setAlias } from '../../src/rhizomorph/aliases.js'
import { createLogger } from '../../src/support/logger.js'

// A respond-only enzyme ships no module at all (phase 2's routing decision), so it needs
// neither @mycelo/septum nor zod — which a /tmp directory could not resolve anyway.
const GREETER = [
  'kind: enzyme', 'name: greeter', 'septum: "^0.11"',
  'commands:', '  - name: hello', '    description: command.hello.description',
  '    respond: reply.hello', '',
].join('\n')

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mycelo-alias-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

function writeGreeter(root: string): void {
  mkdirSync(join(root, 'greeter'), { recursive: true })
  writeFileSync(join(root, 'greeter', 'spore.yaml'), GREETER, 'utf8')
}

// Pins buildRoutes' FIRST caller, germination/germinate.ts. Passing it an empty map instead of
// the table would survive the end-to-end case below, because boot/start.ts rebuilds the map.
it('germination keys its route map by the alias table', async () => {
  const root = join(dir, 'spores')
  writeGreeter(root)
  const { db } = openDatabase(':memory:')
  migrateDatabase(db)
  recordInstall(db, 'greeter', 'enzyme')
  setEnabled(db, 'greeter', true)
  setAlias(db, 'greeter', 'hello', 'salut')

  const registry = await germinate([root], createLogger(), {}, db)

  expect([...registry.routes.keys()]).toEqual(['salut'])
  expect(registry.routes.get('salut')?.qualified).toBe('greeter.hello')
})

// Pins buildRoutes' SECOND caller, boot/start.ts, which rebuilds from only the enzymes that
// started. Passing it an empty map there would put the manifest name back.
it('the registry a started substrate exposes is still keyed by the alias', async () => {
  const root = join(dir, 'spores')
  writeGreeter(root)
  const dbFile = join(dir, 'd.db')
  const seed = openDatabase(dbFile)
  migrateDatabase(seed.db)
  recordInstall(seed.db, 'greeter', 'enzyme')
  setEnabled(seed.db, 'greeter', true)
  setAlias(seed.db, 'greeter', 'hello', 'salut')
  seed.close()

  const configFile = join(dir, 'mycelo.yaml')
  writeFileSync(configFile, `prefix: "/"\nspores: ${root}\ndatabase: ${dbFile}\n`, 'utf8')
  const { registry } = await bootstrap(configFile)

  expect(registry.dormant).toEqual([])
  expect([...registry.routes.keys()]).toEqual(['salut'])
  expect(registry.routes.get('salut')?.declared).toBe('hello')
})

// spec §3.5: /api/plugins and /api/commands must not disagree about the same command's name.
// Measured live: before this, the plugin list said 'hello' while the command list said 'salut'.
it('the plugin list reports the name a caller types, not the declared one', async () => {
  const root = join(dir, 'spores')
  writeGreeter(root)
  const { db } = openDatabase(':memory:')
  migrateDatabase(db)
  recordInstall(db, 'greeter', 'enzyme')
  setEnabled(db, 'greeter', true)
  setAlias(db, 'greeter', 'hello', 'salut')

  const registry = await germinate([root], createLogger(), {}, db)
  const listed = listPlugins(registry, [root], db).find((p) => p.name === 'greeter')

  expect(listed?.commands).toEqual(['salut'])
})
