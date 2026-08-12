import { expect, it, mock } from 'bun:test'
import type { CommandSpec, Enzyme, Hypha, IncomingMessage, Logger, OutgoingContent, Rhiza } from '@mycelo/septum'
import { buildRoutes } from '../../src/germination/registry.js'
import type { GerminatedEnzyme, GerminatedHypha, GerminatedRhiza, Registry } from '../../src/germination/registry.js'
import { migrateDatabase, openDatabase } from '../../src/persistence/db.js'
import { createBus, createEnzymeStartContext } from '../../src/rhizomorph/bus.js'
import type { SporeAccess } from '../../src/rhizomorph/bus.js'
import { createLogger } from '../../src/support/logger.js'

const DEFAULT_COMMANDS: CommandSpec[] = [{ name: 'ping', description: 'Health check', code: 'ping' }]
// None of this file's scopes touch the database; a shared in-memory instance is enough
// to satisfy createBus's required db parameter.
const db = (() => { const { db: opened } = openDatabase(':memory:'); migrateDatabase(opened); return opened })()

function setup(
  instance: Enzyme | null,
  commands: CommandSpec[] = DEFAULT_COMMANDS,
  resolved: readonly string[] = [],
  rhizas: readonly GerminatedRhiza[] = [],
): { registry: Registry; sent: OutgoingContent[] } {
  const sent: OutgoingContent[] = []
  const hypha: Hypha = {
    async connect() {}, listen() {}, async stop() {},
    async send(_c, out) { sent.push(out) },
  }
  const hyphae: GerminatedHypha[] = [{
    name: 'console',
    manifest: { kind: 'hypha', name: 'console', septum: '^1.0', capabilities: ['reactions'] },
    instance: hypha,
    config: {},
  }]
  const enzymes: GerminatedEnzyme[] = [{
    name: 'ping',
    manifest: { kind: 'enzyme', name: 'ping', septum: '^1.0', commands },
    instance,
    resolved: new Set(resolved),
    scopes: [],
    config: {},
  }]
  const order = [...rhizas.map((r) => r.name), 'ping']
  return {
    registry: { hyphae, enzymes, rhizas, dormant: [], routes: buildRoutes(enzymes), order },
    sent,
  }
}

const access = (resolved: string[]): SporeAccess => ({ resolved: new Set(resolved), scopes: [] })
const stubRhiza = (name: string, api: unknown): GerminatedRhiza => ({
  name,
  manifest: { kind: 'rhiza', name, septum: '^0.4' },
  instance: { api } as unknown as Rhiza,
  config: {},
})

it('resolves a declared rhiza through ctx.rhiza()', () => {
  const ctx = createEnzymeStartContext({
    hyphae: [], rhizas: [stubRhiza('mock', { lookup: () => 'x' })],
    logger: createLogger(), access: access(['mock']), mycelium: () => ({}), config: {},
  })
  expect(ctx.rhiza<{ lookup(): string }>('mock').lookup()).toBe('x')
})

it('throws when a rhiza was never declared, naming the target', () => {
  const ctx = createEnzymeStartContext({
    hyphae: [], rhizas: [stubRhiza('mock', {})],
    logger: createLogger(), access: access([]), mycelium: () => ({}), config: {},
  })
  expect(() => ctx.rhiza('mock')).toThrow(/'mock'.*not declared/)
})

it('answers has() from the resolved set, not from what is installed', () => {
  const ctx = createEnzymeStartContext({
    hyphae: [], rhizas: [stubRhiza('mock', {}), stubRhiza('other', {})],
    logger: createLogger(), access: access(['mock']), mycelium: () => ({}), config: {},
  })
  expect(ctx.has('mock')).toBe(true)
  expect(ctx.has('other')).toBe(false)
})

function message(text: string): IncomingMessage {
  return {
    channel: 'console', conversationId: 'c:1', messageId: 'm:1',
    sender: { channel: 'console', externalId: 'local' },
    text, attachments: [], raw: null, receivedAt: new Date(0),
  }
}

it('routes a command to its enzyme and the reply back to the channel', async () => {
  const { registry, sent } = setup({
    handlers: { ping: async (_inv, ctx) => { await ctx.reply({ text: 'pong' }) } },
  })
  const bus = createBus({ registry, db, prefix: '/', logger: createLogger() })
  await bus.deliver('console', message('/ping'))
  expect(sent).toEqual([{ text: 'pong' }])
})

it('names the failed command, not just the channel, when a respond: send throws', async () => {
  const hypha: Hypha = {
    async connect() {}, listen() {}, async stop() {},
    async send() { throw new Error('channel down') },
  }
  const hyphae: GerminatedHypha[] = [{
    name: 'console',
    manifest: { kind: 'hypha', name: 'console', septum: '^1.0', capabilities: [] },
    instance: hypha,
    config: {},
  }]
  const enzymes: GerminatedEnzyme[] = [{
    name: 'ping',
    manifest: {
      kind: 'enzyme', name: 'ping', septum: '^1.0',
      commands: [{ name: 'links', description: 'x', respond: 'Radarr http://radarr:7878' }],
    },
    instance: null,
    resolved: new Set(),
    scopes: [],
    config: {},
  }]
  const registry: Registry = { hyphae, enzymes, rhizas: [], dormant: [], routes: buildRoutes(enzymes), order: ['ping'] }
  const errors: string[] = []
  const logger: Logger = {
    debug() {}, info() {}, warn() {},
    error: (m) => { errors.push(m) },
    child: () => logger,
  }
  const bus = createBus({ registry, db, prefix: '/', logger })
  await bus.deliver('console', message('/links'))
  expect(errors[0]).toContain('ping.links')
})

it('answers a text command without touching the module', async () => {
  const { registry, sent } = setup(null, [
    { name: 'links', description: 'Service URLs', respond: 'Radarr http://radarr:7878' },
  ])
  const bus = createBus({ registry, db, prefix: '/', logger: createLogger() })
  await bus.deliver('console', message('/links'))
  expect(sent).toEqual([{ text: 'Radarr http://radarr:7878' }])
})

it('never calls a handler when the command answers with respond, even with an instance present', async () => {
  let calls = 0
  const { registry, sent } = setup(
    { handlers: { links: async () => { calls++ } } },
    [{ name: 'links', description: 'Service URLs', respond: 'Radarr http://radarr:7878' }],
  )
  const bus = createBus({ registry, db, prefix: '/', logger: createLogger() })
  await bus.deliver('console', message('/links'))
  expect(sent).toEqual([{ text: 'Radarr http://radarr:7878' }])
  expect(calls).toBe(0)
})

it('logs and reports failure, rather than staying silent, when a code command has no loaded instance', async () => {
  const { registry, sent } = setup(null, [{ name: 'boom', description: 'x', code: 'boom' }])
  const errors: string[] = []
  const logger: Logger = {
    debug() {}, info() {}, warn() {},
    error: (m) => { errors.push(m) },
    child: () => logger,
  }
  const bus = createBus({ registry, db, prefix: '/', logger })
  await bus.deliver('console', message('/boom'))
  expect(sent).toEqual([{ text: "command 'boom' failed" }])
  expect(errors[0]).toContain('boom')
})

it('reports failure rather than answering with Object.prototype.constructor when a handler named "constructor" is missing', async () => {
  const { registry, sent } = setup(
    { handlers: {} },
    [{ name: 'boom', description: 'x', code: 'constructor' }],
  )
  const bus = createBus({ registry, db, prefix: '/', logger: createLogger() })
  await bus.deliver('console', message('/boom'))
  expect(sent).toEqual([{ text: "command 'boom' failed" }])
})

it('reports an unknown command without invoking anything', async () => {
  const ping = mock()
  const { registry } = setup({ handlers: { ping } })
  const onUnrouted = mock(async () => {})
  const bus = createBus({ registry, db, prefix: '/', logger: createLogger(), onUnrouted })
  await bus.deliver('console', message('/nope'))
  expect(ping).not.toHaveBeenCalled()
  expect(onUnrouted).toHaveBeenCalledWith(expect.anything(), 'nope')
})

it('ignores text carrying no command', async () => {
  const ping = mock()
  const { registry } = setup({ handlers: { ping } })
  const bus = createBus({ registry, db, prefix: '/', logger: createLogger() })
  await bus.deliver('console', message('just talking'))
  expect(ping).not.toHaveBeenCalled()
})

it('contains a handler that throws and answers on the channel', async () => {
  const { registry, sent } = setup({
    handlers: { ping: async () => { throw new Error('boom') } },
  })
  const bus = createBus({ registry, db, prefix: '/', logger: createLogger() })
  await bus.deliver('console', message('/ping'))
  expect(sent[0]?.text).toContain('failed')
})

it('exposes the channel capabilities to the enzyme', async () => {
  let reported: readonly string[] = []
  const { registry } = setup({
    handlers: { ping: async (_inv, ctx) => { reported = ctx.capabilities.list() } },
  })
  const bus = createBus({ registry, db, prefix: '/', logger: createLogger() })
  await bus.deliver('console', message('/ping'))
  expect(reported).toEqual(['reactions'])
})

it('throws naming the target when ctx.rhiza() reaches a name this enzyme never declared', async () => {
  let caught = ''
  const { registry } = setup({
    handlers: {
      ping: async (_inv, ctx) => {
        try { ctx.rhiza('radarr') } catch (e) { caught = (e as Error).message }
      },
    },
  })
  const bus = createBus({ registry, db, prefix: '/', logger: createLogger() })
  await bus.deliver('console', message('/ping'))
  expect(caught).toContain("'radarr'")
  expect(caught).toContain('not declared')
})

it('resolves a declared rhiza through ctx.rhiza(), reached through the full bus', async () => {
  let looked = ''
  const rhiza = stubRhiza('mock', { lookup: () => 'x' })
  const { registry } = setup(
    { handlers: { ping: async (_inv, ctx) => { looked = ctx.rhiza<{ lookup(): string }>('mock').lookup() } } },
    DEFAULT_COMMANDS,
    ['mock'],
    [rhiza],
  )
  const bus = createBus({ registry, db, prefix: '/', logger: createLogger() })
  await bus.deliver('console', message('/ping'))
  expect(looked).toBe('x')
})

it('still throws for ctx.on(), naming a phase that has not arrived rather than the one that just did', async () => {
  let caught = ''
  const { registry } = setup({
    handlers: {
      ping: async (_inv, ctx) => {
        try { ctx.on('radarr', 'released', () => {}) } catch (e) { caught = (e as Error).message }
      },
    },
  })
  const bus = createBus({ registry, db, prefix: '/', logger: createLogger() })
  await bus.deliver('console', message('/ping'))
  expect(caught).not.toContain('phase 3')
  expect(caught).toContain('not yet scheduled')
})

it('throws a message naming the phase for ctx.principal', async () => {
  let caught = ''
  const { registry } = setup({
    handlers: {
      ping: async (_inv, ctx) => {
        try { void ctx.principal } catch (e) { caught = (e as Error).message }
      },
    },
  })
  const bus = createBus({ registry, db, prefix: '/', logger: createLogger() })
  await bus.deliver('console', message('/ping'))
  expect(caught).toContain('phase 4')
})

it('answers has() false for a name this enzyme never declared', async () => {
  let result = true
  const { registry } = setup({
    handlers: { ping: async (_inv, ctx) => { result = ctx.has('radarr') } },
  })
  const bus = createBus({ registry, db, prefix: '/', logger: createLogger() })
  await bus.deliver('console', message('/ping'))
  expect(result).toBe(false)
})

it("answers has() true only for a name this enzyme's own resolved set carries", async () => {
  let mock = true
  let other = true
  const { registry } = setup(
    { handlers: { ping: async (_inv, ctx) => { mock = ctx.has('mock'); other = ctx.has('other') } } },
    DEFAULT_COMMANDS,
    ['mock'],
    [stubRhiza('mock', {}), stubRhiza('other', {})],
  )
  const bus = createBus({ registry, db, prefix: '/', logger: createLogger() })
  await bus.deliver('console', message('/ping'))
  expect(mock).toBe(true)
  expect(other).toBe(false)
})

it('confines each enzyme to its own resolved set and scopes, not a union across every enzyme', async () => {
  const results: Record<string, unknown> = {}
  const hypha: Hypha = {
    async connect() {}, listen() {}, async stop() {}, async send() {},
  }
  const hyphae: GerminatedHypha[] = [{
    name: 'console',
    manifest: { kind: 'hypha', name: 'console', septum: '^1.0', capabilities: [] },
    instance: hypha,
    config: {},
  }]
  const rhizas: GerminatedRhiza[] = [stubRhiza('mock', {}), stubRhiza('other', {})]
  const enzymes: GerminatedEnzyme[] = [
    {
      name: 'alpha',
      manifest: {
        kind: 'enzyme', name: 'alpha', septum: '^1.0',
        commands: [{ name: 'alpha', description: 'x', code: 'alpha' }],
      },
      instance: {
        handlers: {
          alpha: async (_inv, ctx) => {
            results['alphaHasOther'] = ctx.has('other')
            try { ctx.rhiza('other') } catch (e) { results['alphaOtherError'] = (e as Error).message }
            const myceliumApi = ctx.rhiza<Record<string, unknown>>('mycelium')
            results['alphaListPlugins'] = 'listPlugins' in myceliumApi
            results['alphaHealth'] = 'health' in myceliumApi
          },
        },
      },
      resolved: new Set(['mock', 'mycelium']),
      scopes: ['plugins.read'],
      config: {},
    },
    {
      name: 'beta',
      manifest: {
        kind: 'enzyme', name: 'beta', septum: '^1.0',
        commands: [{ name: 'beta', description: 'x', code: 'beta' }],
      },
      instance: {
        handlers: {
          beta: async (_inv, ctx) => {
            results['betaHasMock'] = ctx.has('mock')
            try { ctx.rhiza('mock') } catch (e) { results['betaMockError'] = (e as Error).message }
            const myceliumApi = ctx.rhiza<Record<string, unknown>>('mycelium')
            results['betaListPlugins'] = 'listPlugins' in myceliumApi
            results['betaHealth'] = 'health' in myceliumApi
          },
        },
      },
      resolved: new Set(['other', 'mycelium']),
      scopes: ['health.read'],
      config: {},
    },
  ]
  const registry: Registry = {
    hyphae, enzymes, rhizas, dormant: [],
    routes: buildRoutes(enzymes),
    order: ['mock', 'other', 'alpha', 'beta'],
  }
  const bus = createBus({ registry, db, prefix: '/', logger: createLogger() })
  await bus.deliver('console', message('/alpha'))
  await bus.deliver('console', message('/beta'))

  expect(results['alphaHasOther']).toBe(false)
  expect(results['alphaOtherError']).toContain("'other'")
  expect(results['alphaOtherError']).toContain('not declared')
  expect(results['alphaListPlugins']).toBe(true)
  expect(results['alphaHealth']).toBe(false)

  expect(results['betaHasMock']).toBe(false)
  expect(results['betaMockError']).toContain("'mock'")
  expect(results['betaMockError']).toContain('not declared')
  expect(results['betaListPlugins']).toBe(false)
  expect(results['betaHealth']).toBe(true)
})

it('contains a malformed message instead of rejecting the fire-and-forget deliver()', async () => {
  const ping = mock()
  const { registry } = setup({ handlers: { ping } })
  const bus = createBus({ registry, db, prefix: '/', logger: createLogger() })
  const malformed = { ...message('/ping'), conversationId: '' }
  expect(bus.deliver('console', malformed)).resolves.toBeUndefined()
  expect(ping).not.toHaveBeenCalled()
})

it('contains an onUnrouted callback that itself throws', async () => {
  const { registry } = setup({ handlers: { ping: async () => {} } })
  const onUnrouted = mock(async () => { throw new Error('onUnrouted exploded') })
  const bus = createBus({ registry, db, prefix: '/', logger: createLogger(), onUnrouted })
  expect(bus.deliver('console', message('/nope'))).resolves.toBeUndefined()
  expect(onUnrouted).toHaveBeenCalled()
})

it('contains a recovery send that also fails, with nowhere left to answer', async () => {
  const hypha: Hypha = {
    async connect() {}, listen() {}, async stop() {},
    async send() { throw new Error('channel down') },
  }
  const hyphae: GerminatedHypha[] = [{
    name: 'console',
    manifest: { kind: 'hypha', name: 'console', septum: '^1.0', capabilities: [] },
    instance: hypha,
    config: {},
  }]
  const enzymes: GerminatedEnzyme[] = [{
    name: 'ping',
    manifest: {
      kind: 'enzyme', name: 'ping', septum: '^1.0',
      commands: [{ name: 'ping', description: 'Health check', code: 'ping' }],
    },
    instance: { handlers: { ping: async () => { throw new Error('boom') } } },
    resolved: new Set(),
    scopes: [],
    config: {},
  }]
  const registry: Registry = { hyphae, enzymes, rhizas: [], dormant: [], routes: buildRoutes(enzymes), order: ['ping'] }
  // A bespoke logger, not createLogger(): distinguishes "contained by the specific
  // recovery-send try" from "contained by the outer catch-all" — both would make the
  // promise resolve, but only the former logs both failures under their own messages.
  const errors: string[] = []
  const logger: Logger = {
    debug() {}, info() {}, warn() {},
    error: (m) => { errors.push(m) },
    child: () => logger,
  }
  const bus = createBus({ registry, db, prefix: '/', logger })
  expect(bus.deliver('console', message('/ping'))).resolves.toBeUndefined()
  expect(errors).toHaveLength(2)
  expect(errors[1]).toContain('could not report')
})

it('rejects an OutgoingContent with nothing set, before handing it to the hypha', async () => {
  const { registry, sent } = setup({
    handlers: { ping: async (_inv, ctx) => { await ctx.reply({}) } },
  })
  const errors: string[] = []
  const logger: Logger = {
    debug() {}, info() {}, warn() {},
    error: (m, meta) => { errors.push(`${m} ${JSON.stringify(meta ?? {})}`) },
    child: () => logger,
  }
  const bus = createBus({ registry, db, prefix: '/', logger })
  expect(bus.deliver('console', message('/ping'))).resolves.toBeUndefined()
  // The empty content never reached the hypha: only the recovery message did, which
  // is how "contained, not process-fatal" is distinguished from "silently accepted".
  expect(sent).toEqual([{ text: "command 'ping' failed" }])
  expect(errors[0]).toContain('at least one of text, attachments, or reactTo')
})
