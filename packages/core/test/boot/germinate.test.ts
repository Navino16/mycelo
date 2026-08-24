import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { Logger } from '@mycelo/septum'
import { germinatePhase, retryGermination } from '../../src/boot/germinate.js'
import { serve } from '../../src/boot/serve.js'
import { createLogger } from '../../src/support/logger.js'

/** Records every warn() call instead of printing it, so a test can inspect them. */
function spyLogger(): { logger: Logger; warnings: string[] } {
  const warnings: string[] = []
  const logger: Logger = {
    debug() {}, info() {}, error() {},
    warn: (m) => { warnings.push(m) },
    child: () => logger,
  }
  return { logger, warnings }
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

function config(): string {
  const file = join(dir, 'mycelo.yaml')
  writeFileSync(file, 'spores: ./spores\ndatabase: ./mycelo.db\n', 'utf8')
  return file
}

const HYPHA_BODY = 'connect: async () => {}, listen: () => {}, stop: async () => {}, send: async () => {}'

/**
 * A single 'console' hypha germinates regardless of `owner`, mirroring the real
 * mycelo.yaml default — so the owner channel is the only variable under test.
 */
async function bootWith(owner: { channel: string; userId: string }): Promise<{ warnings: string[] }> {
  spore('console', {
    'spore.yaml': 'kind: hypha\nname: console\nseptum: "^0.7"\n',
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
  const { logger, warnings } = spyLogger()
  await germinatePhase(served.state, logger)
  return { warnings }
}

/**
 * Two rhizas each requiring the other: the smallest real cycle. Enzymes cannot form one —
 * `evaluate()` marks a requirement whose target is not a rhiza dormant before the graph.
 * Neither needs a module file: `resolve()` throws CycleError before any load.
 */
function cyclingPair(): void {
  for (const [self, other] of [['alpha', 'beta'], ['beta', 'alpha']] as const) {
    spore(self, {
      'spore.yaml': `kind: rhiza\nname: ${self}\nseptum: "^0.7"\nrequires:\n  - rhiza: ${other}\n`,
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
        'spore.yaml': `kind: enzyme\nname: ${name}\nseptum: "^0.7"\ncommands:\n  - name: ping\n    description: ping\n    respond: ${name}.reply\n`,
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
      'spore.yaml': 'kind: enzyme\nname: good\nseptum: "^0.7"\ncommands:\n  - name: good\n    description: good\n    respond: good.reply\n',
    })
    const served = serve(config())
    closeDb = served.closeDb
    const result = await germinatePhase(served.state, createLogger())
    expect(result.status).toBe('germinated')
    expect(served.state.germination.status).toBe('germinated')
  })

  it('replaces the phase-1 translator with one carrying the spore catalogues', async () => {
    spore('good', {
      'spore.yaml': 'kind: enzyme\nname: good\nseptum: "^0.7"\ncommands:\n  - name: good\n    description: good\n    respond: good.reply\n',
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
    const { warnings } = await bootWith({ channel: 'signal', userId: 'u-1' })
    expect(warnings.join(' ')).toContain("owner is on channel 'signal'")
  })

  it('says nothing when a germinated hypha provides the owner channel', async () => {
    const { warnings } = await bootWith({ channel: 'console', userId: 'alice' })
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
      'spore.yaml': 'kind: enzyme\nname: good\nseptum: "^0.7"\ncommands:\n  - name: good\n    description: good\n    respond: good.reply\n',
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
