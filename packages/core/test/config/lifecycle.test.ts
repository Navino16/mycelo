import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { SEPTUM_VERSION, type PluginsRead } from '@mycelo/septum'
import { getInstall, listInstalls, recordInstall, setEnabled, writeSetting } from '../../src/config/store.js'
import { enablePlugin, syncInstalls } from '../../src/config/lifecycle.js'
import { germinate } from '../../src/germination/germinate.js'
import { createMyceliumApi } from '../../src/mycelium-rhiza.js'
import type { Db } from '../../src/persistence/db.js'
import { migrateDatabase, openDatabase } from '../../src/persistence/db.js'
import { pluginSetting } from '../../src/persistence/schema.js'
import { createLogger } from '../../src/support/logger.js'

const SPORES = [resolve(import.meta.dirname, '../../../../fixtures')]

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
        : { success: false, error: { issues: [{ path: ['url'], message: "'url' must be a non-empty string" }] } }
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
    'spore.yaml': 'kind: enzyme\nname: needs-config\nseptum: "^0.11"\n'
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
  syncInstalls(db, [dir])
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
  syncInstalls(db, [dir])
  rmSync(join(dir, 'needs-config'), { recursive: true, force: true })
  syncInstalls(db, [dir])
  expect(getInstall(db, 'needs-config')).not.toBeNull()
  close()
})

// Renamed from 'and names the path': the temp spore's schema is hand-written, so what
// this proves is that enablePlugin carries the schema's own reason through unaltered.
it('enabling refuses while a required setting is missing, and carries the schema\'s reason through', async () => {
  const { db, close } = fresh()
  needsConfig()
  recordInstall(db, 'needs-config', 'enzyme')
  const result = await enablePlugin(db, [dir], 'needs-config')
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
  const result = await enablePlugin(db, [dir], 'needs-config')
  expect(result.ok).toBe(true)
  expect(getInstall(db, 'needs-config')?.enabled).toBe(true)
  close()
})

// A hand-rolled ConfigSchema with a closed JSON Schema: the only shape the undeclared-secret
// rule is not exempt from, and the one an enforcing inhibitor would brick the bot with.
const TYPO_SECRET_MODULE = `
  export default {
    configSchema: {
      safeParse: (input) => ({ success: true, data: input ?? {} }),
      toJsonSchema: () => ({ type: 'object', properties: { url: {} } }),
      secrets: ['apiKye'],
    },
    create: () => ({ handlers: {} }),
  }
`

function typoSecret(name: string, secrets: string): void {
  const module = TYPO_SECRET_MODULE.replace("secrets: ['apiKye']", secrets)
  if (secrets !== "secrets: ['apiKye']" && module === TYPO_SECRET_MODULE) {
    throw new Error('TYPO_SECRET_MODULE anchor text has drifted')
  }
  spore(name, {
    'spore.yaml': `kind: enzyme\nname: ${name}\nseptum: "^0.11"\n`
      + `commands:\n  - name: ${name}\n    description: x\n    respond: hi\n`,
    'src/index.ts': module,
  })
}

// safeParse accepts anything here, so only the secrets cross-check can refuse: germination
// would make this spore dormant, and for an enforcing inhibitor that refuses all traffic
// with /plugin-disable already dead. enable() is the last surface that can still say no.
it('enabling refuses a plugin whose secrets name a field the schema does not declare', async () => {
  const { db, close } = fresh()
  typoSecret('typo', "secrets: ['apiKye']")
  recordInstall(db, 'typo', 'enzyme')
  const result = await enablePlugin(db, [dir], 'typo')
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.reason).toContain('apiKye')
  close()
})

// The regression the blocker needed: a refusal that still enabled the row is the whole
// defect, since the next boot is what turns it into dormancy.
it('a plugin refused for an undeclared secret stays disabled', async () => {
  const { db, close } = fresh()
  typoSecret('typo', "secrets: ['apiKye']")
  recordInstall(db, 'typo', 'enzyme')
  await enablePlugin(db, [dir], 'typo')
  expect(getInstall(db, 'typo')?.enabled).toBe(false)
  close()
})

it('the refusal names every undeclared secret, not only the first', async () => {
  const { db, close } = fresh()
  typoSecret('typos', "secrets: ['apiKye', 'secrit']")
  recordInstall(db, 'typos', 'enzyme')
  const result = await enablePlugin(db, [dir], 'typos')
  expect(result.ok).toBe(false)
  if (!result.ok) {
    expect(result.reason).toContain('apiKye')
    expect(result.reason).toContain('secrit')
  }
  close()
})

// The control: the same shape with a sound declaration must still enable, or the check
// would refuse every plugin that declares a secret at all.
it('enabling accepts a plugin whose secrets name a declared field', async () => {
  const { db, close } = fresh()
  typoSecret('sound', "secrets: ['url']")
  recordInstall(db, 'sound', 'enzyme')
  const result = await enablePlugin(db, [dir], 'sound')
  expect(result.ok).toBe(true)
  expect(getInstall(db, 'sound')?.enabled).toBe(true)
  close()
})

it('enabling refuses a plugin that is not installed', async () => {
  const { db, close } = fresh()
  needsConfig()
  const result = await enablePlugin(db, [dir], 'needs-config')
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.reason).toContain('not installed')
  close()
})

it('enabling refuses a plugin whose directory is absent from disk', async () => {
  const { db, close } = fresh()
  recordInstall(db, 'ghost', 'enzyme')
  const result = await enablePlugin(db, [dir], 'ghost')
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.reason).toContain('present on disk')
  expect(getInstall(db, 'ghost')?.enabled).toBe(false)
  close()
})

// The three ways loadModule() throws. germinate() catches them; enablePlugin declares
// EnableRefusal, and task 8 prints its reason into a chat channel, so a throw here
// reaches the operator as a broken command instead of a diagnostic.
it('enabling refuses, rather than throwing, when the module throws at import', async () => {
  const { db, close } = fresh()
  spore('boomspore', {
    'spore.yaml': 'kind: enzyme\nname: boomspore\nseptum: "^0.11"\n'
      + 'commands:\n  - name: boom\n    description: x\n    code: handleBoom\n',
    'src/index.ts': 'throw new Error("import explodes")\n',
  })
  recordInstall(db, 'boomspore', 'enzyme')
  const result = await enablePlugin(db, [dir], 'boomspore')
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.reason).toContain('import explodes')
  expect(getInstall(db, 'boomspore')?.enabled).toBe(false)
  close()
})

it('enabling refuses, rather than throwing, when the spore has no entry point', async () => {
  const { db, close } = fresh()
  spore('nocode', {
    'spore.yaml': 'kind: enzyme\nname: nocode\nseptum: "^0.11"\n'
      + 'commands:\n  - name: nocode\n    description: x\n    code: handleNocode\n',
  })
  recordInstall(db, 'nocode', 'enzyme')
  const result = await enablePlugin(db, [dir], 'nocode')
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.reason).toContain('no entry point')
  close()
})

it('enabling refuses, rather than throwing, when the default export has no create()', async () => {
  const { db, close } = fresh()
  spore('nocreate', {
    'spore.yaml': 'kind: enzyme\nname: nocreate\nseptum: "^0.11"\n'
      + 'commands:\n  - name: nocreate\n    description: x\n    code: handleNocreate\n',
    'src/index.ts': 'export default { }\n',
  })
  recordInstall(db, 'nocreate', 'enzyme')
  const result = await enablePlugin(db, [dir], 'nocreate')
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.reason).toContain('create()')
  close()
})

it('enabling names the manifest fault instead of claiming the spore is absent', async () => {
  const { db, close } = fresh()
  spore('brokenyaml', { 'spore.yaml': 'kind: enzyme\nname: brokenyaml\n' })
  recordInstall(db, 'brokenyaml', 'enzyme')
  const result = await enablePlugin(db, [dir], 'brokenyaml')
  expect(result.ok).toBe(false)
  if (!result.ok) {
    // A YAML typo told the operator the directory was missing: no path to the fix.
    expect(result.reason).not.toContain('present on disk')
    // 'septum' is the field this manifest omits. Asserting the word 'manifest' alone
    // passed with the guard removed, off a TypeError reading `manifest.kind`.
    expect(result.reason).toContain("unreadable manifest: invalid manifest at 'septum'")
  }
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

// germinate() decided dormancy before it decided enablement, so every consequence of a
// failed manifest applied to a plugin the operator had already switched off.
describe('a disabled plugin whose manifest no longer parses', () => {
  // `kind` and `enforcing` are the two literals manifest.ts sniffs off the raw YAML; the
  // missing `septum` is what makes parseManifest reject it.
  function brokenGate(): void {
    spore('gate', { 'spore.yaml': 'kind: inhibitor\nname: gate\nenforcing: true\n' })
  }

  it('refuses all traffic while it is enabled', async () => {
    const { db, close } = fresh()
    brokenGate()
    recordInstall(db, 'gate', 'inhibitor')
    setEnabled(db, 'gate', true)
    const registry = await germinate([dir], createLogger(), {}, db)
    expect(registry.brokenEnforcing).toEqual(['gate'])
    close()
  })

  it('refuses nothing once it is disabled', async () => {
    const { db, close } = fresh()
    brokenGate()
    recordInstall(db, 'gate', 'inhibitor')
    const registry = await germinate([dir], createLogger(), {}, db)
    // admit() runs before the command is parsed, so brokenEnforcing is unreachable from
    // any channel: a YAML typo in an already-disabled plugin would need a shell to undo.
    expect(registry.brokenEnforcing).toEqual([])
    expect(registry.dormant).toEqual([])
    close()
  })

  it('is listed disabled rather than dormant, and reports enabled: false', async () => {
    const { db, close } = fresh()
    brokenGate()
    recordInstall(db, 'gate', 'inhibitor')
    const registry = await germinate([dir], createLogger(), {}, db)
    const api = createMyceliumApi(registry, ['plugins.read'], async () => {}, db, [dir]) as PluginsRead
    expect(api.listPlugins()).toEqual([
      { name: 'gate', kind: 'inhibitor', commands: [], state: 'disabled', enabled: false },
    ])
    close()
  })
})

describe('enablePlugin refuses rather than rejecting when validation itself throws', () => {
  it('when the plugin\'s own safeParse throws', async () => {
    const { db, close } = fresh()
    spore('throwspore', {
      'spore.yaml': 'kind: enzyme\nname: throwspore\nseptum: "^0.11"\n'
        + 'commands:\n  - name: throwspore\n    description: x\n    code: handleIt\n',
      'src/index.ts': 'export default {\n'
        + '  configSchema: { safeParse: () => { throw new Error("predicate exploded") } },\n'
        + '  create: () => ({ handlers: { handleIt: async () => {} } }),\n'
        + '}\n',
    })
    recordInstall(db, 'throwspore', 'enzyme')
    const result = await enablePlugin(db, [dir], 'throwspore')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('predicate exploded')
    close()
  })

  it('when a stored setting is not the JSON readSettings expects', async () => {
    const { db, close } = fresh()
    needsConfig()
    recordInstall(db, 'needs-config', 'enzyme')
    // Bypasses writeSetting, which stringifies: only a hand-edited or corrupted row
    // reaches readSettings with text JSON.parse cannot read.
    db.insert(pluginSetting).values({ pluginName: 'needs-config', key: 'url', value: 'not json', isSecret: false }).run()
    const result = await enablePlugin(db, [dir], 'needs-config')
    expect(result.ok).toBe(false)
    // Not merely refused: the ordinary "url is missing" refusal satisfies ok === false too,
    // so only the reason distinguishes a caught throw from a rejected config.
    if (!result.ok) expect(result.reason).toContain('validating it threw')
    close()
  })
})

describe('syncInstalls writes all or nothing', () => {
  // The only injection point: recordInstall is the sole insert in the walk, so a trap
  // that fails the third one reproduces a crash, SIGKILL or OOM mid-sync.
  function failingAfter(db: Db, inserts: number): Db {
    let seen = 0
    return new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'insert') {
          seen += 1
          if (seen > inserts) return () => { throw new Error('write failed mid-sync') }
        }
        return Reflect.get(target, prop, receiver) as unknown
      },
    })
  }

  it('records nothing when a write fails partway through the first run', () => {
    const { db, close } = fresh()
    expect(() => syncInstalls(failingAfter(db, 2), SPORES)).toThrow('write failed mid-sync')
    // Rows without their enabling would make the next boot a non-first run, which records
    // the remainder disabled — including `admin`, the only way back in.
    expect(listInstalls(db)).toEqual([])
    close()
  })
})

it('refuses to enable a spore whose septum range excludes the running septum', async () => {
  // The third config-shaped dormancy cause enablePlugin has to see: for an enforcing
  // inhibitor, dormancy refuses all traffic and no channel command can undo it.
  spore('stale', {
    'spore.yaml': [
      'kind: enzyme',
      'name: stale',
      'septum: "^0.9"',
      'commands:',
      '  - name: hi',
      '    description: command.hi.description',
      '    respond: reply.hi',
    ].join('\n'),
  })
  const { db, close } = fresh()
  try {
    recordInstall(db, 'stale', 'enzyme')
    const result = await enablePlugin(db, [dir], 'stale')
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.reason).toContain('^0.9')
    expect(result.ok ? '' : result.reason).toContain(SEPTUM_VERSION)
    // The positive beside the negative: the row must still be off.
    expect(getInstall(db, 'stale')?.enabled).toBe(false)
  } finally {
    close()
  }
})

it('enables a spore whose septum range covers the running septum', async () => {
  spore('fresh-enough', {
    'spore.yaml': [
      'kind: enzyme',
      'name: fresh-enough',
      `septum: ">=${SEPTUM_VERSION}"`,
      'commands:',
      '  - name: hi',
      '    description: command.hi.description',
      '    respond: reply.hi',
    ].join('\n'),
  })
  const { db, close } = fresh()
  try {
    recordInstall(db, 'fresh-enough', 'enzyme')
    expect(await enablePlugin(db, [dir], 'fresh-enough')).toEqual({ ok: true })
    expect(getInstall(db, 'fresh-enough')?.enabled).toBe(true)
  } finally {
    close()
  }
})
