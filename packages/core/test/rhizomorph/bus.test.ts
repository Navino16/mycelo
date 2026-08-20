import { resolve as resolvePath } from 'node:path'
import { describe, expect, it, mock } from 'bun:test'
import type { ChannelCapability, CommandSpec, Enzyme, Hypha, IncomingMessage, Logger, OutgoingContent, Principal, Rhiza, Verdict } from '@mycelo/septum'
import type { AdmissionChain } from '../../src/admission/chain.js'
import { listConversations } from '../../src/conversations/registry.js'
import { buildRoutes } from '../../src/germination/registry.js'
import type { GerminatedEnzyme, GerminatedHypha, GerminatedRhiza, Registry } from '../../src/germination/registry.js'
import { resolvePrincipal } from '../../src/identity/resolve.js'
import { migrateDatabase, openDatabase } from '../../src/persistence/db.js'
import type { Db } from '../../src/persistence/db.js'
import { setContextRule } from '../../src/restrictions/rules.js'
import { channelIdentity, principalRole, role, roleCommand } from '../../src/persistence/schema.js'
import { catalogsOf } from '../support/catalogs.js'
import { loadCoreCatalogs } from '../../src/i18n/core-catalogs.js'
import { setConversationLocale, setPrincipalLocale } from '../../src/i18n/locale.js'
import { createTranslator } from '../../src/i18n/translator.js'
import type { Translator } from '../../src/i18n/translator.js'
import { createBus, createEnzymeStartContext } from '../../src/rhizomorph/bus.js'
import type { Bus, BusOptions, SporeAccess } from '../../src/rhizomorph/bus.js'
import { createLogger } from '../../src/support/logger.js'

const DEFAULT_COMMANDS: CommandSpec[] = [{ name: 'ping', description: 'Health check', code: 'ping' }]
// No test here reaches the mycelium fallback's disk-backed methods; the real fixtures
// directory is passed so nothing in this file depends on a path that does not exist.
const SPORES = [resolvePath(import.meta.dirname, '../../../../fixtures')]
// None of this file's scopes touch the database; a shared in-memory instance is enough
// to satisfy createBus's required db parameter.
const db = (() => { const { db: opened } = openDatabase(':memory:'); migrateDatabase(opened); return opened })()
// This file's pre-existing tests are not about admission: an admit-all chain lets them
// exercise routing exactly as before phase 4 wired the gate in front of it.
const admitAll: AdmissionChain = { admit: () => Promise.resolve({ allow: true }) }
// Same reasoning for authorization: every pre-existing test sends as 'local', so
// granting it '*' up front reproduces the pre-phase-4 always-dispatches behaviour.
const localPrincipal = resolvePrincipal(db, { channel: 'console', externalId: 'local' })
db.insert(role).values({ id: 'r:test-all', name: 'test-all' }).run()
db.insert(roleCommand).values({ roleId: 'r:test-all', pattern: '*' }).run()
db.insert(principalRole).values({ principalId: localPrincipal.id, roleId: 'r:test-all' }).run()

// The core catalogue, not an empty one: bus.ts's own "command '<x>' failed" now renders
// through it, so the pre-existing tests asserting that English sentence need it present.
function busFor(registry: Registry, overrides: Partial<BusOptions> = {}): Bus {
  return createBus({
    registry, db, admission: admitAll, prefix: '/', sporesDirs: SPORES, logger: createLogger(),
    translator: createTranslator({ catalogs: loadCoreCatalogs(), defaultLocale: 'en', logger: createLogger() }),
    defaultLocale: 'en',
    ...overrides,
  })
}

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
    registry: { hyphae, enzymes, rhizas, inhibitors: [], dormant: [], routes: buildRoutes(enzymes), order, brokenEnforcing: [], catalogs: new Map() },
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
    domain: 'test', translator: createTranslator({ catalogs: new Map(), defaultLocale: 'en', logger: createLogger() }),
    db, defaultLocale: 'en',
  })
  expect(ctx.rhiza<{ lookup(): string }>('mock').lookup()).toBe('x')
})

it('throws when a rhiza was never declared, naming the target', () => {
  const ctx = createEnzymeStartContext({
    hyphae: [], rhizas: [stubRhiza('mock', {})],
    logger: createLogger(), access: access([]), mycelium: () => ({}), config: {},
    domain: 'test', translator: createTranslator({ catalogs: new Map(), defaultLocale: 'en', logger: createLogger() }),
    db, defaultLocale: 'en',
  })
  expect(() => ctx.rhiza('mock')).toThrow(/'mock'.*not declared/)
})

it('answers has() from the resolved set, not from what is installed', () => {
  const ctx = createEnzymeStartContext({
    hyphae: [], rhizas: [stubRhiza('mock', {}), stubRhiza('other', {})],
    logger: createLogger(), access: access(['mock']), mycelium: () => ({}), config: {},
    domain: 'test', translator: createTranslator({ catalogs: new Map(), defaultLocale: 'en', logger: createLogger() }),
    db, defaultLocale: 'en',
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
  const bus = busFor(registry)
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
  const registry: Registry = { hyphae, enzymes, rhizas: [], inhibitors: [], dormant: [], routes: buildRoutes(enzymes), order: ['ping'], brokenEnforcing: [], catalogs: new Map() }
  const errors: string[] = []
  const logger: Logger = {
    debug() {}, info() {}, warn() {},
    error: (m) => { errors.push(m) },
    child: () => logger,
  }
  const bus = busFor(registry, { logger })
  await bus.deliver('console', message('/links'))
  expect(errors[0]).toContain('ping.links')
})

it('answers a text command without touching the module', async () => {
  const { registry, sent } = setup(null, [
    { name: 'links', description: 'Service URLs', respond: 'Radarr http://radarr:7878' },
  ])
  const bus = busFor(registry)
  await bus.deliver('console', message('/links'))
  expect(sent).toEqual([{ text: 'Radarr http://radarr:7878' }])
})

it('never calls a handler when the command answers with respond, even with an instance present', async () => {
  let calls = 0
  const { registry, sent } = setup(
    { handlers: { links: async () => { calls++ } } },
    [{ name: 'links', description: 'Service URLs', respond: 'Radarr http://radarr:7878' }],
  )
  const bus = busFor(registry)
  await bus.deliver('console', message('/links'))
  expect(sent).toEqual([{ text: 'Radarr http://radarr:7878' }])
  expect(calls).toBe(0)
})

describe("respond: resolves through the declaring spore's domain", () => {
  it("renders a respond: command as a catalogue key in the declaring spore's domain", async () => {
    const { registry, sent } = setup(null, [
      { name: 'links', description: 'x', respond: 'links.text' },
    ])
    const bus = busFor(registry, {
      translator: createTranslator({
        catalogs: catalogsOf({ ping: { en: { 'links.text': 'Radarr http://radarr:7878' } } }),
        defaultLocale: 'en', logger: createLogger(),
      }),
    })
    await bus.deliver('console', message('/links'))
    expect(sent).toEqual([{ text: 'Radarr http://radarr:7878' }])
  })

  it('renders the same key differently for a reader who chose another language', async () => {
    const { registry, sent } = setup(null, [
      { name: 'links', description: 'x', respond: 'links.text' },
    ])
    const bus = busFor(registry, {
      translator: createTranslator({
        catalogs: catalogsOf({
          ping: {
            en: { 'links.text': 'Radarr http://radarr:7878' },
            fr: { 'links.text': 'Radarr, adresse http://radarr:7878' },
          },
        }),
        defaultLocale: 'en', logger: createLogger(),
      }),
    })
    setPrincipalLocale(db, localPrincipal.id, 'fr')
    await bus.deliver('console', message('/links'))
    setPrincipalLocale(db, localPrincipal.id, 'en')
    expect(sent).toEqual([{ text: 'Radarr, adresse http://radarr:7878' }])
  })

  it('returns a respond: string literally when no catalogue declares it', async () => {
    const { registry, sent } = setup(null, [
      { name: 'ping-text', description: 'x', respond: 'pong' },
    ])
    const bus = busFor(registry)
    await bus.deliver('console', message('/ping-text'))
    expect(sent).toEqual([{ text: 'pong' }])
  })

  it('does not pass an undeclared respond: through ICU', async () => {
    const { registry, sent } = setup(null, [
      { name: 'help-text', description: 'x', respond: 'type {help}' },
    ])
    const bus = busFor(registry)
    await bus.deliver('console', message('/help-text'))
    expect(sent).toEqual([{ text: 'type {help}' }])
  })

  // Two enzymes declaring the same key with different text: a mutation collapsing the
  // domain to a constant would pass one message and fail the other.
  it("resolves in the declaring spore's domain, not the reader's or the core's", async () => {
    const sent: OutgoingContent[] = []
    const hypha: Hypha = {
      async connect() {}, listen() {}, async stop() {},
      async send(_c, out) { sent.push(out) },
    }
    const hyphae: GerminatedHypha[] = [{
      name: 'console',
      manifest: { kind: 'hypha', name: 'console', septum: '^1.0', capabilities: [] },
      instance: hypha,
      config: {},
    }]
    const enzymes: GerminatedEnzyme[] = [
      {
        name: 'alpha',
        manifest: {
          kind: 'enzyme', name: 'alpha', septum: '^1.0',
          commands: [{ name: 'hello-alpha', description: 'x', respond: 'greeting.text' }],
        },
        instance: null, resolved: new Set(), scopes: [], config: {},
      },
      {
        name: 'beta',
        manifest: {
          kind: 'enzyme', name: 'beta', septum: '^1.0',
          commands: [{ name: 'hello-beta', description: 'x', respond: 'greeting.text' }],
        },
        instance: null, resolved: new Set(), scopes: [], config: {},
      },
    ]
    const registry: Registry = {
      hyphae, enzymes, rhizas: [], inhibitors: [], dormant: [],
      routes: buildRoutes(enzymes), order: ['alpha', 'beta'], brokenEnforcing: [], catalogs: new Map(),
    }
    const bus = busFor(registry, {
      translator: createTranslator({
        catalogs: catalogsOf({
          alpha: { en: { 'greeting.text': 'Hello from alpha' } },
          beta: { en: { 'greeting.text': 'Hello from beta' } },
        }),
        defaultLocale: 'en', logger: createLogger(),
      }),
    })
    await bus.deliver('console', message('/hello-alpha'))
    await bus.deliver('console', message('/hello-beta'))
    expect(sent).toEqual([{ text: 'Hello from alpha' }, { text: 'Hello from beta' }])
  })
})

it('logs and reports failure, rather than staying silent, when a code command has no loaded instance', async () => {
  const { registry, sent } = setup(null, [{ name: 'boom', description: 'x', code: 'boom' }])
  const errors: string[] = []
  const logger: Logger = {
    debug() {}, info() {}, warn() {},
    error: (m) => { errors.push(m) },
    child: () => logger,
  }
  const bus = busFor(registry, { logger })
  await bus.deliver('console', message('/boom'))
  expect(sent).toEqual([{ text: "command 'boom' failed" }])
  expect(errors[0]).toContain('boom')
})

it('reports failure rather than answering with Object.prototype.constructor when a handler named "constructor" is missing', async () => {
  const { registry, sent } = setup(
    { handlers: {} },
    [{ name: 'boom', description: 'x', code: 'constructor' }],
  )
  const bus = busFor(registry)
  await bus.deliver('console', message('/boom'))
  expect(sent).toEqual([{ text: "command 'boom' failed" }])
})

it('reports an unknown command without invoking anything', async () => {
  const ping = mock()
  const { registry } = setup({ handlers: { ping } })
  const onUnrouted = mock(async () => {})
  const bus = busFor(registry, { onUnrouted })
  await bus.deliver('console', message('/nope'))
  expect(ping).not.toHaveBeenCalled()
  expect(onUnrouted).toHaveBeenCalledWith(expect.anything(), 'nope', 'en')
})

it('ignores text carrying no command', async () => {
  const ping = mock()
  const { registry } = setup({ handlers: { ping } })
  const bus = busFor(registry)
  await bus.deliver('console', message('just talking'))
  expect(ping).not.toHaveBeenCalled()
})

it('contains a handler that throws and answers on the channel', async () => {
  const { registry, sent } = setup({
    handlers: { ping: async () => { throw new Error('boom') } },
  })
  const bus = busFor(registry)
  await bus.deliver('console', message('/ping'))
  expect(sent[0]?.text).toContain('failed')
})

it('exposes the channel capabilities to the enzyme', async () => {
  let reported: readonly string[] = []
  const { registry } = setup({
    handlers: { ping: async (_inv, ctx) => { reported = ctx.capabilities.list() } },
  })
  const bus = busFor(registry)
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
  const bus = busFor(registry)
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
  const bus = busFor(registry)
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
  const bus = busFor(registry)
  await bus.deliver('console', message('/ping'))
  expect(caught).not.toContain('phase 3')
  expect(caught).toContain('not yet scheduled')
})

it('gives ctx.principal the sender resolved for this message', async () => {
  let seen: Principal | undefined
  const { registry } = setup({
    handlers: { ping: async (_inv, ctx) => { seen = ctx.principal } },
  })
  const bus = busFor(registry)
  await bus.deliver('console', message('/ping'))
  expect(seen?.identities).toEqual([{ channel: 'console', externalId: 'local' }])
})

it('answers has() false for a name this enzyme never declared', async () => {
  let result = true
  const { registry } = setup({
    handlers: { ping: async (_inv, ctx) => { result = ctx.has('radarr') } },
  })
  const bus = busFor(registry)
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
  const bus = busFor(registry)
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
    hyphae, enzymes, rhizas, inhibitors: [], dormant: [],
    routes: buildRoutes(enzymes),
    order: ['mock', 'other', 'alpha', 'beta'],
    brokenEnforcing: [],
    catalogs: new Map(),
  }
  const bus = busFor(registry)
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
  const bus = busFor(registry)
  const malformed = { ...message('/ping'), conversationId: '' }
  expect(bus.deliver('console', malformed)).resolves.toBeUndefined()
  expect(ping).not.toHaveBeenCalled()
})

it('contains an onUnrouted callback that itself throws', async () => {
  const { registry } = setup({ handlers: { ping: async () => {} } })
  const onUnrouted = mock(async () => { throw new Error('onUnrouted exploded') })
  const bus = busFor(registry, { onUnrouted })
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
  const registry: Registry = { hyphae, enzymes, rhizas: [], inhibitors: [], dormant: [], routes: buildRoutes(enzymes), order: ['ping'], brokenEnforcing: [], catalogs: new Map() }
  // A bespoke logger, not createLogger(): distinguishes "contained by the specific
  // recovery-send try" from "contained by the outer catch-all" — both would make the
  // promise resolve, but only the former logs both failures under their own messages.
  const errors: string[] = []
  const logger: Logger = {
    debug() {}, info() {}, warn() {},
    error: (m) => { errors.push(m) },
    child: () => logger,
  }
  const bus = busFor(registry, { logger })
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
  const bus = busFor(registry, { logger })
  expect(bus.deliver('console', message('/ping'))).resolves.toBeUndefined()
  // The empty content never reached the hypha: only the recovery message did, which
  // is how "contained, not process-fatal" is distinguished from "silently accepted".
  expect(sent).toEqual([{ text: "command 'ping' failed" }])
  expect(errors[0]).toContain('at least one of text, attachments, or reactTo')
})

function fresh(): Db {
  const { db: opened } = openDatabase(':memory:')
  migrateDatabase(opened)
  return opened
}

function grant(target: Db, principalId: string, roleName: string, patterns: readonly string[]): void {
  const id = `r:${roleName}`
  target.insert(role).values({ id, name: roleName }).run()
  for (const pattern of patterns) target.insert(roleCommand).values({ roleId: id, pattern }).run()
  target.insert(principalRole).values({ principalId, roleId: id }).run()
}

interface DeliverOptions {
  conversationId?: string
  group?: { id: string, name?: string }
  displayName?: string
}

interface Harness {
  db: Db
  sent: string[]
  seen: { principal?: Principal }
  deliver(text: string, externalId: string, options?: DeliverOptions): Promise<void>
}

function harness(options: {
  commands: readonly CommandSpec[]
  admit?: (message: IncomingMessage) => Promise<Verdict>
  defaultRole?: string
  db?: Db
  capabilities?: readonly ChannelCapability[]
}): Harness {
  const harnessDb = options.db ?? fresh()
  const sent: string[] = []
  const seen: { principal?: Principal } = {}
  const hypha = {
    name: 'console',
    config: {},
    manifest: { kind: 'hypha' as const, name: 'console', septum: '^0.5', capabilities: options.capabilities ?? [] },
    instance: {
      connect: () => Promise.resolve(),
      listen: () => {},
      stop: () => Promise.resolve(),
      send: (_c: string, out: { text?: string }) => { sent.push(out.text ?? ''); return Promise.resolve() },
    },
  } as unknown as GerminatedHypha
  const enzyme = {
    name: 'media',
    config: {},
    resolved: new Set<string>(),
    scopes: [],
    manifest: { kind: 'enzyme' as const, name: 'media', septum: '^0.5', commands: options.commands },
    instance: {
      handlers: {
        handleMovies: async (_invocation: unknown, ctx: { principal: Principal; reply: (c: { text: string }) => Promise<void> }) => {
          seen.principal = ctx.principal
          await ctx.reply({ text: 'Dune (2021) via mock' })
        },
      },
    },
  } as unknown as GerminatedEnzyme
  const registry: Registry = {
    hyphae: [hypha], enzymes: [enzyme], rhizas: [], inhibitors: [], dormant: [],
    routes: buildRoutes([enzyme]), order: ['media'], brokenEnforcing: [], catalogs: new Map(),
  }
  const logger = {
    info: () => {}, debug: () => {}, warn: () => {}, error: () => {},
    child: () => logger,
  } as unknown as Parameters<typeof createBus>[0]['logger']
  const bus = createBus({
    registry, prefix: '/', logger, db: harnessDb,
    sporesDirs: SPORES,
    ...(options.defaultRole === undefined ? {} : { defaultRole: options.defaultRole }),
    translator: createTranslator({ catalogs: new Map(), defaultLocale: 'en', logger: createLogger() }),
    defaultLocale: 'en',
    admission: { admit: options.admit ?? (() => Promise.resolve({ allow: true })) },
    onUnrouted: async (msg, command) => {
      if (command !== null) sent.push(`unknown command '${command}'`)
      await Promise.resolve()
    },
    onDenied: async (_msg, qualified) => {
      sent.push(`denied ${qualified}`)
      await Promise.resolve()
    },
    onUnsupported: async (_msg, qualified, capability) => {
      sent.push(`unsupported ${qualified} ${capability}`)
      await Promise.resolve()
    },
    onOutOfContext: async (_msg, qualified, where) => {
      sent.push(`out-of-context ${qualified} ${where}`)
      await Promise.resolve()
    },
  })
  return {
    db: harnessDb, sent, seen,
    deliver: (text, externalId, deliverOptions = {}) => bus.deliver('console', {
      channel: 'console',
      conversationId: deliverOptions.conversationId ?? 'c1',
      messageId: 'm1',
      ...(deliverOptions.group === undefined ? {} : { group: deliverOptions.group }),
      sender: {
        channel: 'console',
        externalId,
        ...(deliverOptions.displayName === undefined ? {} : { displayName: deliverOptions.displayName }),
      },
      text, attachments: [], raw: null, receivedAt: new Date(),
    }),
  }
}

const codeCommand: CommandSpec = { name: 'movies', description: 'Search', code: 'handleMovies' }
const respondCommand: CommandSpec = { name: 'where', description: 'Where', respond: 'nowhere' }
const reactRespondCommand: CommandSpec = {
  name: 'where', description: 'Where', respond: 'nowhere', capabilities: ['reactions'],
}
const reactCodeCommand: CommandSpec = {
  name: 'movies', description: 'Search', code: 'handleMovies', capabilities: ['reactions'],
}

describe('deliver, admission and authorization', () => {
  it('refuses a command the principal holds no pattern for, and says so', async () => {
    const h = harness({ commands: [codeCommand] })
    await h.deliver('/movies Dune', 'bob')
    expect(h.sent).toEqual(['denied media.movies'])
  })

  it('runs the handler once a pattern grants the command', async () => {
    const testDb = fresh()
    const bob = resolvePrincipal(testDb, { channel: 'console', externalId: 'bob' })
    grant(testDb, bob.id, 'guest', ['media.*'])
    const h = harness({ commands: [codeCommand], db: testDb })
    await h.deliver('/movies Dune', 'bob')
    expect(h.sent).toEqual(['Dune (2021) via mock'])
  })

  it('guards a respond: command exactly like a code: one', async () => {
    const h = harness({ commands: [respondCommand] })
    await h.deliver('/where', 'bob')
    expect(h.sent).toEqual(['denied media.where'])
  })

  it('answers a respond: command once it is granted', async () => {
    const testDb = fresh()
    const bob = resolvePrincipal(testDb, { channel: 'console', externalId: 'bob' })
    grant(testDb, bob.id, 'guest', ['media.where'])
    const h = harness({ commands: [respondCommand], db: testDb })
    await h.deliver('/where', 'bob')
    expect(h.sent).toEqual(['nowhere'])
  })

  it('gives the handler the real principal, with its id and roles', async () => {
    const testDb = fresh()
    const bob = resolvePrincipal(testDb, { channel: 'console', externalId: 'bob' })
    grant(testDb, bob.id, 'guest', ['media.*'])
    const h = harness({ commands: [codeCommand], db: testDb })
    await h.deliver('/movies Dune', 'bob')
    expect(h.seen.principal?.id).toBe(bob.id)
    expect(h.seen.principal?.roles).toEqual(['guest'])
    expect(h.seen.principal?.identities).toHaveLength(1)
  })

  it('creates no principal for a sender admission refused', async () => {
    const h = harness({
      commands: [codeCommand],
      admit: () => Promise.resolve({ allow: false, reason: 'not a member of the group' }),
    })
    await h.deliver('/movies Dune', 'carol')
    expect(h.db.select().from(channelIdentity).all()).toEqual([])
  })

  it('says nothing on the channel when admission refuses', async () => {
    const h = harness({
      commands: [codeCommand],
      admit: () => Promise.resolve({ allow: false, reason: 'not a member of the group' }),
    })
    await h.deliver('/movies Dune', 'carol')
    expect(h.sent).toEqual([])
  })

  it('does not authorize an unrouted message, it simply reports the unknown command', async () => {
    const h = harness({ commands: [codeCommand] })
    await h.deliver('/nosuch', 'bob')
    expect(h.sent).toEqual(["unknown command 'nosuch'"])
  })

  it('resolves the principal before parsing, so a stranger chatting is still recorded', async () => {
    const h = harness({ commands: [codeCommand] })
    await h.deliver('hello there', 'bob')
    expect(h.sent).toEqual([])
    expect(h.db.select().from(channelIdentity).all()).toHaveLength(1)
  })

  it('assigns the configured default role on first contact', async () => {
    const testDb = fresh()
    testDb.insert(role).values({ id: 'r:guest', name: 'guest' }).run()
    testDb.insert(roleCommand).values({ roleId: 'r:guest', pattern: 'media.*' }).run()
    const h = harness({ commands: [codeCommand], db: testDb, defaultRole: 'guest' })
    await h.deliver('/movies Dune', 'newcomer')
    expect(h.sent).toEqual(['Dune (2021) via mock'])
  })

  it('abandons the message when identity resolution throws', async () => {
    const h = harness({ commands: [codeCommand], defaultRole: 'ghost' })
    await h.deliver('/movies Dune', 'bob')
    expect(h.sent).toEqual([])
  })
})

describe('the conversation registry', () => {
  it('records an admitted conversation and never records a refused one', async () => {
    const testDb = fresh()
    const bob = resolvePrincipal(testDb, { channel: 'console', externalId: 'bob' })
    grant(testDb, bob.id, 'guest', ['media.*'])
    const h = harness({
      commands: [codeCommand],
      db: testDb,
      admit: (msg) => Promise.resolve(
        msg.conversationId === 'refused' ? { allow: false, reason: 'no' } : { allow: true },
      ),
    })
    await h.deliver('/movies Dune', 'bob', { conversationId: 'admitted' })
    await h.deliver('/movies Dune', 'bob', { conversationId: 'refused' })
    expect(listConversations(testDb).map((c) => c.conversationId)).toEqual(['admitted'])
  })

  it('records a group conversation with its platform name', async () => {
    const testDb = fresh()
    const bob = resolvePrincipal(testDb, { channel: 'console', externalId: 'bob' })
    grant(testDb, bob.id, 'guest', ['media.*'])
    const h = harness({ commands: [codeCommand], db: testDb })
    await h.deliver('/movies Dune', 'bob', { conversationId: 'g1', group: { id: 'g1', name: 'weekend' } })
    expect(listConversations(testDb)[0]).toMatchObject({ kind: 'group', label: 'weekend' })
  })

  // The registry exists so a silent group can still be picked as a broadcast target;
  // a message with no command at all must record one exactly like a routed one does.
  it('records a conversation for text carrying no command at all', async () => {
    const testDb = fresh()
    const h = harness({ commands: [codeCommand], db: testDb })
    await h.deliver('just chatting', 'bob')
    expect(listConversations(testDb).map((c) => c.conversationId)).toEqual(['c1'])
  })

  it('still dispatches the command, and logs, when the write itself throws', async () => {
    const { registry, sent } = setup({
      handlers: { ping: async (_inv, ctx) => { await ctx.reply({ text: 'pong' }) } },
    })
    const throwingDb = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'insert') return () => { throw new Error('disk full') }
        return Reflect.get(target, prop, receiver) as unknown
      },
    })
    const errors: string[] = []
    const logger: Logger = {
      debug() {}, info() {}, warn() {},
      error: (m) => { errors.push(m) },
      child: () => logger,
    }
    const bus = busFor(registry, { db: throwingDb, logger })
    await bus.deliver('console', message('/ping'))
    expect(sent).toEqual([{ text: 'pong' }])
    expect(errors[0]).toContain('could not record the conversation')
  })
})

function granted(commands: readonly CommandSpec[], capabilities: readonly ChannelCapability[] = []) {
  const testDb = fresh()
  const bob = resolvePrincipal(testDb, { channel: 'console', externalId: 'bob' })
  grant(testDb, bob.id, 'guest', ['media.*'])
  const h = harness({ commands, db: testDb, capabilities })
  return { h, testDb }
}

describe('channel capabilities on a command', () => {
  it('refuses a code: command whose capability the emitting channel does not declare', async () => {
    const { h } = granted([reactCodeCommand], [])
    await h.deliver('/movies Dune', 'bob')
    expect(h.sent).toEqual(['unsupported media.movies reactions'])
  })

  it('refuses a respond: command on capability exactly as it refuses a code: one', async () => {
    const { h } = granted([reactRespondCommand], [])
    await h.deliver('/where', 'bob')
    expect(h.sent).toEqual(['unsupported media.where reactions'])
  })

  it('dispatches when the channel declares every capability the command needs', async () => {
    const { h } = granted([reactCodeCommand], ['reactions'])
    await h.deliver('/movies Dune', 'bob')
    expect(h.sent).toEqual(['Dune (2021) via mock'])
  })

  it('dispatches a command that declares no capability at all', async () => {
    const { h } = granted([codeCommand], [])
    await h.deliver('/movies Dune', 'bob')
    expect(h.sent).toEqual(['Dune (2021) via mock'])
  })

  it('denies a sender with no pattern before ever checking the channel capability', async () => {
    const h = harness({ commands: [reactCodeCommand], capabilities: [] })
    await h.deliver('/movies Dune', 'bob')
    expect(h.sent).toEqual(['denied media.movies'])
  })
})

describe('conversation context rules', () => {
  it('refuses a command outside the conversation kind its rule names, and allows it inside', async () => {
    const { testDb, h } = granted([codeCommand])
    setContextRule(testDb, 'media.movies', 'dm')
    await h.deliver('/movies Dune', 'bob', { conversationId: 'g1', group: { id: 'g1', name: 'weekend' } })
    expect(h.sent).toEqual(['out-of-context media.movies dm'])
    await h.deliver('/movies Dune', 'bob')
    expect(h.sent).toEqual(['out-of-context media.movies dm', 'Dune (2021) via mock'])
  })

  it('applies a context rule to a respond: command exactly as to a code: one', async () => {
    const { testDb, h } = granted([respondCommand])
    setContextRule(testDb, '*', 'group')
    await h.deliver('/where', 'bob')
    expect(h.sent).toEqual(['out-of-context media.where group'])
  })

  it('checks the context rule only after the role check', async () => {
    // carol holds no role at all, so she must hit onDenied and never learn where the
    // command lives — the ordering the design argues for.
    const { testDb, h } = granted([codeCommand])
    setContextRule(testDb, 'media.movies', 'dm')
    await h.deliver('/movies Dune', 'carol', { conversationId: 'g1', group: { id: 'g1' } })
    expect(h.sent).toEqual(['denied media.movies'])
  })
})

// One test per gate would let three of the four regress unseen, since each is a
// separate `await onX?.(...)` call site in deliver() — the four are asserted together
// because they share one wiring (the trailing locale argument) and one failure mode
// (a call site left without it).
describe('the four refusal callbacks, threaded with the locale bus.ts resolved', () => {
  it("passes the reader's locale, not the default, to each of onUnrouted/onDenied/onUnsupported/onOutOfContext", async () => {
    const testDb = fresh()
    const bob = resolvePrincipal(testDb, { channel: 'console', externalId: 'bob' })
    setPrincipalLocale(testDb, bob.id, 'fr')
    grant(testDb, bob.id, 'guest', ['media.react', 'media.whoami'])
    setContextRule(testDb, 'media.whoami', 'dm')

    const hypha = {
      name: 'console', config: {},
      manifest: { kind: 'hypha' as const, name: 'console', septum: '^0.5', capabilities: [] },
      instance: {
        connect: () => Promise.resolve(), listen: () => {}, stop: () => Promise.resolve(),
        send: () => Promise.resolve(),
      },
    } as unknown as GerminatedHypha
    const enzyme = {
      name: 'media', config: {}, resolved: new Set<string>(), scopes: [],
      manifest: {
        kind: 'enzyme' as const, name: 'media', septum: '^0.5',
        commands: [
          { name: 'movies', description: 'x', code: 'movies' },
          { name: 'react', description: 'x', code: 'react', capabilities: ['reactions'] },
          { name: 'whoami', description: 'x', respond: 'x' },
        ],
      },
      instance: { handlers: { movies: async () => {}, react: async () => {} } },
    } as unknown as GerminatedEnzyme
    const registry: Registry = {
      hyphae: [hypha], enzymes: [enzyme], rhizas: [], inhibitors: [], dormant: [],
      routes: buildRoutes([enzyme]), order: ['media'], brokenEnforcing: [], catalogs: new Map(),
    }

    // Mirrors boot/start.ts's own four callbacks, so a passing test here proves bus.ts's
    // plumbing, not merely that some translator was called.
    const locales: string[] = []
    const stub: Translator = {
      translate: (domain, key, locale) => { locales.push(locale); return `${domain}:${key}` },
      availableLocales: () => ['en', 'fr'],
    }
    const shortName = (qualified: string): string => qualified.slice(qualified.indexOf('.') + 1)
    const sent: string[] = []
    const logger: Logger = {
      debug() {}, info() {}, warn() {}, error() {},
      child: () => logger,
    }
    const bus = createBus({
      registry, prefix: '/', logger, db: testDb, sporesDirs: SPORES,
      admission: admitAll,
      translator: stub, defaultLocale: 'en',
      onUnrouted: async (_msg, command, locale) => {
        if (command === null) return
        sent.push(stub.translate('core', 'command.unknown', locale, { command }))
      },
      onDenied: async (_msg, qualified, locale) => {
        sent.push(stub.translate('core', 'command.denied', locale, { command: shortName(qualified) }))
      },
      onUnsupported: async (_msg, qualified, capability, locale) => {
        sent.push(stub.translate('core', 'command.unsupported', locale, { command: shortName(qualified), capability }))
      },
      onOutOfContext: async (_msg, qualified, where, locale) => {
        sent.push(stub.translate('core', `context.${where}`, locale, { command: shortName(qualified) }))
      },
    })
    const send = (text: string, group?: { id: string }): Promise<void> => bus.deliver('console', {
      channel: 'console', conversationId: group?.id ?? 'c1', messageId: 'm1',
      ...(group === undefined ? {} : { group }),
      sender: { channel: 'console', externalId: 'bob' },
      text, attachments: [], raw: null, receivedAt: new Date(),
    })

    await send('/nosuch')
    await send('/movies Dune')
    await send('/react')
    await send('/whoami', { id: 'g1' })

    expect(sent).toEqual([
      'core:command.unknown', 'core:command.denied', 'core:command.unsupported', 'core:context.dm',
    ])
    expect(locales).toEqual(['fr', 'fr', 'fr', 'fr'])
  })
})

describe('per-message locale resolution', () => {
  const GREETINGS = { ping: { en: { greeting: 'hello' }, fr: { greeting: 'bonjour' }, ru: { greeting: 'привет' } } }

  function greeter(): ReturnType<typeof setup> {
    return setup({ handlers: { ping: async (_inv, ctx) => { await ctx.reply({ text: ctx.t('greeting') }) } } })
  }

  it('answers a handler in the locale the sender chose, not the default', async () => {
    const { registry, sent } = greeter()
    setPrincipalLocale(db, localPrincipal.id, 'fr')
    await busFor(registry, {
      translator: createTranslator({ catalogs: catalogsOf(GREETINGS), defaultLocale: 'en', logger: createLogger() }),
    }).deliver('console', message('/ping'))
    setPrincipalLocale(db, localPrincipal.id, 'en')
    expect(sent).toEqual([{ text: 'bonjour' }])
  })

  it("answers in the conversation's locale even when the sender chose another", async () => {
    const { registry, sent } = greeter()
    setPrincipalLocale(db, localPrincipal.id, 'fr')
    // The conversation must exist before it can carry a locale: recordConversation runs on
    // the first admitted message, so deliver once, then set the locale, then deliver again.
    const bus = busFor(registry, {
      translator: createTranslator({ catalogs: catalogsOf(GREETINGS), defaultLocale: 'en', logger: createLogger() }),
    })
    await bus.deliver('console', message('/ping'))
    setConversationLocale(db, 'console', 'c:1', 'ru')
    await bus.deliver('console', message('/ping'))
    setPrincipalLocale(db, localPrincipal.id, 'en')
    setConversationLocale(db, 'console', 'c:1', 'en')
    // Both replies asserted, not only the second: a resolver that ignored the principal
    // entirely would still produce 'привет' on the second line.
    expect(sent).toEqual([{ text: 'bonjour' }, { text: 'привет' }])
  })

  it('gives start() the default locale, since no message exists yet', () => {
    const ctx = createEnzymeStartContext({
      hyphae: [], rhizas: [], logger: createLogger(), access: access([]), mycelium: () => ({}),
      config: {}, db, domain: 'ping', defaultLocale: 'fr',
      translator: createTranslator({ catalogs: catalogsOf(GREETINGS), defaultLocale: 'en', logger: createLogger() }),
    })
    expect(ctx.t('greeting')).toBe('bonjour')
  })

  it('answers localeFor() from the conversation, falling back to the default', async () => {
    setConversationLocale(db, 'console', 'c:1', 'ru')
    const ctx = createEnzymeStartContext({
      hyphae: [], rhizas: [], logger: createLogger(), access: access([]), mycelium: () => ({}),
      config: {}, db, domain: 'ping', defaultLocale: 'en',
      translator: createTranslator({ catalogs: new Map(), defaultLocale: 'en', logger: createLogger() }),
    })
    const inConversation = await ctx.localeFor({ channel: 'console', conversationId: 'c:1' })
    const fallback = await ctx.localeFor({ channel: 'console', conversationId: 'never-seen' })
    setConversationLocale(db, 'console', 'c:1', 'en')
    expect(inConversation).toBe('ru')
    expect(fallback).toBe('en')
  })
})
