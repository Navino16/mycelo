import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { Logger } from '@mycelo/septum'
import { germinatePhase, retryGermination } from '../../src/boot/germinate.js'
import { serve } from '../../src/boot/serve.js'
import { listSources } from '../../src/sporangium/sources.js'
import { createLogger } from '../../src/support/logger.js'

/** Records every info()/warn() call instead of printing it, so a test can inspect them. */
function spyLogger(): {
  logger: Logger
  warnings: string[]
  infos: string[]
  warnMeta: (Record<string, unknown> | undefined)[]
} {
  const warnings: string[] = []
  const infos: string[] = []
  const warnMeta: (Record<string, unknown> | undefined)[] = []
  const logger: Logger = {
    debug() {}, error() {},
    info: (m) => { infos.push(m) },
    warn: (m, meta) => { warnings.push(m); warnMeta.push(meta) },
    child: () => logger,
  }
  return { logger, warnings, infos, warnMeta }
}

let dir: string
let closeDb: (() => void) | undefined

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mycelo-phase2-')) })
afterEach(() => { closeDb?.(); closeDb = undefined; rmSync(dir, { recursive: true, force: true }) })

function spore(name: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const file = join(dir, 'spores', name, rel)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, content, 'utf8')
  }
}

/** `database: ./mycelo.db` puts the managed root at `<dir>/spores`, which `spore()` writes into. */
function config(roots: readonly string[] = ['./spores']): string {
  const file = join(dir, 'mycelo.yaml')
  const spores = roots.length === 1 ? roots.join('') : `\n${roots.map((r) => `  - ${r}`).join('\n')}`
  writeFileSync(file, `spores: ${spores}\ndatabase: ./mycelo.db\n`, 'utf8')
  return file
}

function root(name: string): string {
  const path = join(dir, name)
  mkdirSync(path, { recursive: true })
  return path
}

const HYPHA_BODY = 'connect: async () => {}, listen: () => {}, stop: async () => {}, send: async () => {}'

/**
 * A single 'console' hypha germinates regardless of `owner`, mirroring the real
 * mycelo.yaml default — so the owner channel is the only variable under test.
 */
async function bootWith(
  owner: { channel: string; userId: string },
): Promise<{ warnings: string[]; infos: string[]; warnMeta: (Record<string, unknown> | undefined)[] }> {
  spore('console', {
    'spore.yaml': 'kind: hypha\nname: console\nseptum: "^0.11"\n',
    'src/index.ts': `export default { create: () => ({ ${HYPHA_BODY} }) }\n`,
  })
  const file = join(dir, 'mycelo.yaml')
  writeFileSync(
    file,
    `spores: ./spores\ndatabase: ./mycelo.db\nowner:\n  channel: ${owner.channel}\n  userId: ${owner.userId}\n`,
    'utf8',
  )
  const served = serve(file)
  closeDb = served.closeDb
  const { logger, warnings, infos, warnMeta } = spyLogger()
  await germinatePhase(served.state, logger)
  return { warnings, infos, warnMeta }
}

/**
 * Two rhizas each requiring the other: the smallest real cycle. Enzymes cannot form one —
 * `evaluate()` marks a requirement whose target is not a rhiza dormant before the graph.
 * Neither needs a module file: `resolve()` throws CycleError before any load.
 */
function cyclingPair(): void {
  for (const [self, other] of [['alpha', 'beta'], ['beta', 'alpha']] as const) {
    spore(self, {
      'spore.yaml': `kind: rhiza\nname: ${self}\nseptum: "^0.11"\nrequires:\n  - rhiza: ${other}\n`,
    })
  }
}

describe('phase 2 germination', () => {
  it('degrades on a cycle instead of throwing', async () => {
    cyclingPair()
    const served = serve(config())
    closeDb = served.closeDb
    const result = await germinatePhase(served.state, createLogger())
    expect(result.status).toBe('degraded')
    if (result.status !== 'degraded') throw new Error('unreachable')
    expect(result.failure.kind).toBe('cycle')
    // The plural case: a cycle report that kept only the head would lose every spore
    // after the first, which is what the operator needs to break the loop.
    if (result.failure.kind !== 'cycle') throw new Error('unreachable')
    expect([...result.failure.spores].sort()).toEqual(['alpha', 'beta'])
    expect(served.state.germination.status).toBe('degraded')
  })

  it('degrades on a command collision instead of throwing', async () => {
    for (const name of ['alpha', 'beta']) {
      spore(name, {
        'spore.yaml': `kind: enzyme\nname: ${name}\nseptum: "^0.11"\ncommands:\n  - name: ping\n    description: ping\n    respond: ${name}.reply\n`,
      })
    }
    const served = serve(config())
    closeDb = served.closeDb
    const result = await germinatePhase(served.state, createLogger())
    expect(result).toMatchObject({
      status: 'degraded',
      failure: { kind: 'collision', command: 'ping', plugins: ['alpha', 'beta'] },
    })
    expect(served.state.germination.status).toBe('degraded')
  })

  it('propagates a database fault instead of degrading', () => {
    const served = serve(config())
    served.closeDb()
    // Degraded mode is for faults a UI action repairs (§8.1); an unusable database is not
    // one, so syncInstalls and readAllSettings sit outside the catch.
    expect(germinatePhase(served.state, createLogger())).rejects.toThrow()
    expect(served.state.germination.status).toBe('starting')
  })

  it('germinates when nothing is fatal', async () => {
    spore('good', {
      'spore.yaml': 'kind: enzyme\nname: good\nseptum: "^0.11"\ncommands:\n  - name: good\n    description: good\n    respond: good.reply\n',
    })
    const served = serve(config())
    closeDb = served.closeDb
    const result = await germinatePhase(served.state, createLogger())
    expect(result.status).toBe('germinated')
    expect(served.state.germination.status).toBe('germinated')
  })

  it('replaces the phase-1 translator with one carrying the spore catalogues', async () => {
    spore('good', {
      'spore.yaml': 'kind: enzyme\nname: good\nseptum: "^0.11"\ncommands:\n  - name: good\n    description: good\n    respond: good.reply\n',
      'translations/en.yaml': 'greet: hello from good\n',
    })
    const served = serve(config())
    closeDb = served.closeDb
    expect(served.state.translator.translate('good', 'greet', 'en')).toBe('greet')
    await germinatePhase(served.state, createLogger())
    expect(served.state.translator.translate('good', 'greet', 'en')).toBe('hello from good')
    // The core's own domain must survive the merge, or every refusal renders as a key.
    expect(served.state.translator.translate('core', 'command.unknown', 'en', { command: 'x' }))
      .not.toBe('command.unknown')
  })
})

describe('warnUninhabitableOwner', () => {
  it('warns when the configured owner is on a channel no germinated hypha provides', async () => {
    const { warnings, warnMeta } = await bootWith({ channel: 'signal', userId: 'u-1' })
    expect(warnings.join(' ')).toContain("owner is on channel 'signal'")
    // The operator's whole remedy path: userId is what POST /api/people/:id/roles needs,
    // and germinated is which channel to write in owner: instead.
    expect(warnMeta[0]).toEqual({ userId: 'u-1', germinated: ['console'] })
  })

  it('says nothing when a germinated hypha provides the owner channel', async () => {
    const { warnings, infos } = await bootWith({ channel: 'console', userId: 'alice' })
    // Proves the spy captured this germination at all, so the empty filter below
    // is not vacuously true of a capture that recorded nothing.
    expect(infos.join(' ')).toContain('recorded 1 spore(s): console')
    expect(warnings.filter((w) => w.includes('owner is on channel'))).toEqual([])
  })
})

describe('retryGermination', () => {
  it('joins two concurrent callers into one germination', async () => {
    cyclingPair()
    const served = serve(config())
    closeDb = served.closeDb
    await germinatePhase(served.state, createLogger())
    const first = retryGermination(served.state, createLogger())
    const second = retryGermination(served.state, createLogger())
    const [a, b] = await Promise.all([first, second])
    expect(a).toBe(b)
  })

  it('refuses when the runtime is not degraded', async () => {
    spore('good', {
      'spore.yaml': 'kind: enzyme\nname: good\nseptum: "^0.11"\ncommands:\n  - name: good\n    description: good\n    respond: good.reply\n',
    })
    const served = serve(config())
    closeDb = served.closeDb
    await germinatePhase(served.state, createLogger())
    expect(retryGermination(served.state, createLogger())).rejects.toThrow(/only be retried while/)
  })

  // Every other retry test retries once. Dropping the `.finally` that clears
  // `state.retrying` survived the whole suite (campaign M34): the second retry would
  // return the first attempt's settled promise, so an operator who fixed the fault would
  // be shown the old failure until the process restarted.
  it('a second retry re-germinates rather than replaying the first attempt\'s result', async () => {
    cyclingPair()
    const served = serve(config())
    closeDb = served.closeDb
    await germinatePhase(served.state, createLogger())
    expect(served.state.germination.status).toBe('degraded')

    // Retry against the unrepaired cycle: still degraded, and the promise must be cleared.
    expect((await retryGermination(served.state, createLogger())).status).toBe('degraded')
    expect(served.state.retrying).toBeUndefined()

    // Break the cycle, exactly as `POST /api/plugins/beta/disable` does, then retry again.
    rmSync(join(dir, 'spores', 'beta'), { recursive: true, force: true })
    expect((await retryGermination(served.state, createLogger())).status).toBe('germinated')
  })
})

describe('the sporangium rows boot writes', () => {
  it('seeds the official source once and writes one local row per configured root', async () => {
    const roots = [root('a'), root('b')]
    const served = serve(config(['./a', './b']))
    closeDb = served.closeDb
    await germinatePhase(served.state, createLogger())
    const listed = listSources(served.state.db)
    expect(listed.filter((s) => s.official)).toHaveLength(1)
    // Two roots, two rows: a single-root fixture passes even if only the last is written.
    expect(listed.filter((s) => s.driver === 'local').map((s) => s.location).sort()).toEqual([...roots].sort())
    // The managed root is the core's, so it is discovered but never mirrored as a local one.
    expect(listed.map((s) => s.location)).not.toContain(join(dir, 'spores'))
  })

  it('is idempotent across boots: no duplicate official row and no duplicate local rows', async () => {
    const first = serve(config(['./a', './b']))
    root('a'); root('b')
    await germinatePhase(first.state, createLogger())
    first.closeDb()
    const second = serve(config(['./a', './b']))
    closeDb = second.closeDb
    await germinatePhase(second.state, createLogger())
    const listed = listSources(second.state.db)
    expect(listed.filter((s) => s.official)).toHaveLength(1)
    expect(listed.filter((s) => s.driver === 'local')).toHaveLength(2)
  })
})

describe('the managed root', () => {
  it('germinates a spore no configured root lists', async () => {
    root('elsewhere')
    spore('installed', {
      'spore.yaml': 'kind: enzyme\nname: installed\nseptum: "^0.11"\ncommands:\n  - name: installed\n    description: x\n    respond: installed.reply\n',
    })
    const served = serve(config(['./elsewhere']))
    closeDb = served.closeDb
    const result = await germinatePhase(served.state, createLogger())
    expect(result.status).toBe('germinated')
    if (result.status !== 'germinated') throw new Error('unreachable')
    expect(result.mycelium.registry.enzymes.map((e) => e.name)).toEqual(['installed'])
  })

  it('is not discovered twice when a configured root already names it', async () => {
    spore('good', {
      'spore.yaml': 'kind: enzyme\nname: good\nseptum: "^0.11"\ncommands:\n  - name: good\n    description: x\n    respond: good.reply\n',
    })
    // `spores: ./spores` and `database: ./mycelo.db` is the ordinary layout, and it puts
    // both roots on the same directory: unguarded, assertNoCollisions refuses the boot.
    const served = serve(config())
    closeDb = served.closeDb
    const result = await germinatePhase(served.state, createLogger())
    expect(result.status).toBe('germinated')
    if (result.status !== 'germinated') throw new Error('unreachable')
    expect(result.mycelium.registry.enzymes.map((e) => e.name)).toEqual(['good'])
  })

  it('collides with a configured root that holds the same directory name', async () => {
    // The managed root is a root like any other, and design §4.2 refuses a duplicate directory
    // across all of them — pinned across the managed root, not only across configured ones.
    root('elsewhere')
    const manifest = 'kind: enzyme\nname: dup\nseptum: "^0.11"\ncommands:\n  - name: dup\n    description: x\n    respond: dup.reply\n'
    mkdirSync(join(dir, 'elsewhere', 'dup'), { recursive: true })
    writeFileSync(join(dir, 'elsewhere', 'dup', 'spore.yaml'), manifest, 'utf8')
    spore('dup', { 'spore.yaml': manifest })
    const served = serve(config(['./elsewhere']))
    closeDb = served.closeDb
    // Thrown, not degraded: the remedy is a filesystem edit, not a UI action (design §4.2).
    expect(germinatePhase(served.state, createLogger()))
      .rejects.toThrow(new RegExp(`'dup'.*${join(dir, 'elsewhere', 'dup')}.*${join(dir, 'spores', 'dup')}`, 's'))
  })

  it('is not reported as a missing spores directory before the first install', async () => {
    root('elsewhere')
    const served = serve(config(['./elsewhere']))
    closeDb = served.closeDb
    const { logger, warnings } = spyLogger()
    await germinatePhase(served.state, logger)
    expect(existsSync(join(dir, 'spores'))).toBe(false)
    expect(warnings.filter((w) => w.includes('spores directory does not exist'))).toEqual([])

    // The control: a *configured* root that is absent is still named. Without it, filtering
    // every absent root out passes this test while silencing the operator's only clue.
    const other = serve(config(['./absent']))
    const second = spyLogger()
    await germinatePhase(other.state, second.logger)
    other.closeDb()
    expect(second.warnings.some((w) => w.includes(join(dir, 'absent')))).toBe(true)
  })

  it('is reachable through the mycelium mount, which every channel command goes through', async () => {
    // The API is not the only door: `/plugin-config` and `/plugin-set` read the same lookup
    // through createMyceliumApi, and a mount handed only the configured roots answers
    // `available: false` for a spore that is installed and running.
    root('elsewhere')
    spore('installed', {
      'spore.yaml': 'kind: enzyme\nname: installed\nseptum: "^0.11"\n'
        + 'commands:\n  - name: installed\n    description: x\n    code: handleInstalled\n',
      'index.js': `
        export default {
          configSchema: {
            safeParse: (input) => ({ success: true, data: input }),
            toJsonSchema: () => ({ type: 'object', properties: { token: { type: 'string' } } }),
          },
          create: () => ({ handlers: { handleInstalled: async () => {} } }),
        }
      `,
    })
    const probeFile = join(dir, 'probe.json')
    mkdirSync(join(dir, 'elsewhere', 'prober'), { recursive: true })
    writeFileSync(join(dir, 'elsewhere', 'prober', 'spore.yaml'),
      'kind: enzyme\nname: prober\nseptum: "^0.11"\n'
      + 'commands:\n  - name: probe\n    description: x\n    code: handleProbe\n'
      + 'requires:\n  - rhiza: mycelium\n    scopes: [plugins.configure]\n', 'utf8')
    writeFileSync(join(dir, 'elsewhere', 'prober', 'index.js'), `
      import { writeFileSync } from 'node:fs'
      export default {
        create: () => ({
          start: async (ctx) => {
            const schema = await ctx.rhiza('mycelium').formSchema('installed')
            writeFileSync(${JSON.stringify(probeFile)}, JSON.stringify(schema))
          },
          stop: async () => {},
          handlers: { handleProbe: async () => {} },
        }),
      }
    `, 'utf8')

    const served = serve(config(['./elsewhere']))
    closeDb = served.closeDb
    expect((await germinatePhase(served.state, createLogger())).status).toBe('germinated')
    expect(JSON.parse(readFileSync(probeFile, 'utf8')) as { available: boolean })
      .toMatchObject({ available: true })
  })

  it('sweeps what a crashed install left in .staging', async () => {
    root('elsewhere')
    // Two of them: removeTree clears the parent, so a sweep of one child would pass with one.
    for (const name of ['x-abc', 'x-def']) {
      const staging = join(dir, 'spores', '.staging', name)
      mkdirSync(staging, { recursive: true })
      writeFileSync(join(staging, 'junk'), 'residue', 'utf8')
    }
    const served = serve(config(['./elsewhere']))
    closeDb = served.closeDb
    await germinatePhase(served.state, createLogger())
    expect(existsSync(join(dir, 'spores', '.staging'))).toBe(false)
  })

  it('boots anyway, warning, when the staging directory cannot be removed', async () => {
    root('elsewhere')
    const managed = join(dir, 'spores')
    mkdirSync(join(managed, '.staging', 'x-abc'), { recursive: true })
    chmodSync(managed, 0o500)
    try {
      const served = serve(config(['./elsewhere']))
      closeDb = served.closeDb
      const { logger, warnings } = spyLogger()
      const result = await germinatePhase(served.state, logger)
      expect(result.status).toBe('germinated')
      expect(warnings.filter((w) => w.includes('staging directory'))).toHaveLength(1)
    } finally {
      chmodSync(managed, 0o700)
    }
  })
})
