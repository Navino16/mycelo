import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, spyOn } from 'bun:test'
import type { IncomingMessage } from '@mycelo/septum'
import { bootstrap, germinationBanner } from '../src/mycelium.js'

function message(channel: string, text: string): IncomingMessage {
  return {
    channel, conversationId: 'c:1', messageId: 'm:1',
    sender: { channel, externalId: 'local' },
    text, attachments: [], raw: null, receivedAt: new Date(0),
  }
}

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mycelo-mycelium-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

function spore(name: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const file = join(dir, name, rel)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, content, 'utf8')
  }
}

it('keeps other hyphae starting when one throws in connect(), and marks it dormant', async () => {
  spore('bad', {
    'spore.yaml': 'kind: hypha\nname: bad\nseptum: "^1.0"\n',
    'src/index.ts': [
      'export default {',
      '  create: () => ({',
      "    connect: () => { throw new Error('boom') },",
      '    listen: () => {},',
      '    stop: async () => {},',
      '    send: async () => {},',
      '  }),',
      '}',
    ].join('\n'),
  })
  spore('good', {
    'spore.yaml': 'kind: hypha\nname: good\nseptum: "^1.0"\n',
    'src/index.ts': [
      'export default {',
      '  create: () => ({',
      '    connect: async () => {},',
      '    listen: () => {},',
      '    stop: async () => {},',
      '    send: async () => {},',
      '  }),',
      '}',
    ].join('\n'),
  })
  const configFile = join(dir, 'mycelo.yaml')
  writeFileSync(configFile, `prefix: "/"\nspores: ${dir}\n`, 'utf8')

  const { registry } = await bootstrap(configFile)
  expect(registry.hyphae.map((h) => h.name)).toEqual(['good'])
  expect(registry.dormant.find((d) => d.name === 'bad')?.reason).toContain('boom')
})

it('keeps other hyphae listening when one throws in listen(), and marks it dormant', async () => {
  spore('bad', {
    'spore.yaml': 'kind: hypha\nname: bad\nseptum: "^1.0"\n',
    'src/index.ts': [
      'export default {',
      '  create: () => ({',
      '    connect: async () => {},',
      "    listen: () => { throw new Error('boom') },",
      '    stop: async () => {},',
      '    send: async () => {},',
      '  }),',
      '}',
    ].join('\n'),
  })
  spore('good', {
    'spore.yaml': 'kind: hypha\nname: good\nseptum: "^1.0"\n',
    'src/index.ts': [
      'export default {',
      '  create: () => ({',
      '    connect: async () => {},',
      '    listen: () => {},',
      '    stop: async () => {},',
      '    send: async () => {},',
      '  }),',
      '}',
    ].join('\n'),
  })
  const configFile = join(dir, 'mycelo.yaml')
  writeFileSync(configFile, `prefix: "/"\nspores: ${dir}\n`, 'utf8')

  const { registry } = await bootstrap(configFile)
  expect(registry.hyphae.map((h) => h.name)).toEqual(['good'])
  expect(registry.dormant.find((d) => d.name === 'bad')?.reason).toContain('boom')
})

it('starts a rhiza before the enzyme that requires it, so ctx.rhiza() sees it already started', async () => {
  spore('store', {
    'spore.yaml': 'kind: rhiza\nname: store\nseptum: "^0.4"\n',
    'src/index.ts': [
      'export default {',
      '  create: () => {',
      '    const state = { started: false }',
      '    return {',
      '      async start() { state.started = true },',
      '      async stop() {},',
      "      health: async () => ({ state: 'healthy', checkedAt: new Date() }),",
      '      api: { isStarted: () => state.started },',
      '    }',
      '  },',
      '}',
    ].join('\n'),
  })
  spore('user', {
    'spore.yaml': [
      'kind: enzyme', 'name: user', 'septum: "^0.4"',
      'requires:', '  - rhiza: store',
      'commands:', '  - name: user', '    description: x', '    code: user', '',
    ].join('\n'),
    'src/index.ts': [
      'export default {',
      '  create: () => {',
      '    const observed = {}',
      '    return {',
      '      observed,',
      '      async start(ctx) { observed.sawStarted = ctx.rhiza("store").isStarted() },',
      '      async stop() {},',
      '      handlers: { user: async () => {} },',
      '    }',
      '  },',
      '}',
    ].join('\n'),
  })
  const configFile = join(dir, 'mycelo.yaml')
  writeFileSync(configFile, `prefix: "/"\nspores: ${dir}\n`, 'utf8')

  const { registry } = await bootstrap(configFile)
  expect(registry.dormant).toEqual([])

  const user = registry.enzymes.find((e) => e.name === 'user')
  const observed = (user?.instance as unknown as { observed: Record<string, unknown> }).observed
  expect(observed.sawStarted).toBe(true)
})

it('invokes Enzyme.start() with a working push()/capabilitiesOf(), and has()/rhiza() reading the resolved set, not a phase gate', async () => {
  spore('good', {
    'spore.yaml': 'kind: hypha\nname: good\nseptum: "^1.0"\n',
    'src/index.ts': [
      'const sent = []',
      'export default {',
      '  create: () => ({',
      '    sent,',
      '    connect: async () => {},',
      '    listen: () => {},',
      '    stop: async () => {},',
      '    send: async (_id, out) => { sent.push(out) },',
      '  }),',
      '}',
    ].join('\n'),
  })
  spore('probe', {
    'spore.yaml': 'kind: enzyme\nname: probe\nseptum: "^1.0"\ncommands:\n  - name: probe\n    description: x\n    code: probe\n',
    'src/index.ts': [
      'export default {',
      '  create: () => {',
      '    const observed = {}',
      '    return {',
      '      observed,',
      '      async start(ctx) {',
      '        observed.has = ctx.has("radarr")',
      '        try { ctx.rhiza("radarr") } catch (e) { observed.rhizaError = e.message }',
      '        try { ctx.on("radarr", "released", () => {}) } catch (e) { observed.onError = e.message }',
      '        await ctx.push({ channel: "good", conversationId: "c:1" }, { text: "started" })',
      '      },',
      '      async stop() {},',
      '      handlers: { probe: async () => {} },',
      '    }',
      '  },',
      '}',
    ].join('\n'),
  })
  const configFile = join(dir, 'mycelo.yaml')
  writeFileSync(configFile, `prefix: "/"\nspores: ${dir}\n`, 'utf8')

  const { registry } = await bootstrap(configFile)

  const good = registry.hyphae.find((h) => h.name === 'good')
  const sent = (good?.instance as unknown as { sent: { text: string }[] }).sent
  expect(sent).toEqual([{ text: 'started' }])

  const probe = registry.enzymes.find((e) => e.name === 'probe')
  const observed = (probe?.instance as unknown as { observed: Record<string, unknown> }).observed
  // 'probe' declares no requires, so 'radarr' is not in its resolved set: has() is
  // false and rhiza() names the target rather than a phase — phase 3 has arrived.
  expect(observed.has).toBe(false)
  expect(observed.rhizaError).toContain("'radarr'")
  expect(observed.rhizaError).toContain('not declared')
  // ctx.on() genuinely is not scheduled yet, so its message must not claim phase 3.
  expect(observed.onError).not.toContain('phase 3')
  expect(observed.onError).toContain('not yet scheduled')
})

it('lets an enzyme push from start(), because hyphae are connected before any enzyme starts', async () => {
  spore('channel', {
    'spore.yaml': 'kind: hypha\nname: channel\nseptum: "^1.0"\n',
    'src/index.ts': [
      'const order = []',
      'export default {',
      '  create: () => ({',
      '    order,',
      '    connect: async () => { order.push("connect") },',
      '    listen: () => { order.push("listen") },',
      '    stop: async () => {},',
      '    send: async () => { order.push("send") },',
      '  }),',
      '}',
    ].join('\n'),
  })
  spore('pusher', {
    'spore.yaml': 'kind: enzyme\nname: pusher\nseptum: "^1.0"\ncommands:\n  - name: pusher\n    description: x\n    code: pusher\n',
    'src/index.ts': [
      'export default {',
      '  create: () => ({',
      '    async start(ctx) {',
      '      await ctx.push({ channel: "channel", conversationId: "c:1" }, { text: "hi" })',
      '    },',
      '    async stop() {},',
      '    handlers: { pusher: async () => {} },',
      '  }),',
      '}',
    ].join('\n'),
  })
  const configFile = join(dir, 'mycelo.yaml')
  writeFileSync(configFile, `prefix: "/"\nspores: ${dir}\n`, 'utf8')

  const { registry } = await bootstrap(configFile)
  expect(registry.dormant).toEqual([])

  const channel = registry.hyphae.find((h) => h.name === 'channel')
  const order = (channel?.instance as unknown as { order: string[] }).order
  // Before the connect/listen split, an enzyme's start() ran before any hypha's
  // connect(), so this push would have reached a client that had never opened.
  expect(order).toEqual(['connect', 'send', 'listen'])
})

it('sends an enzyme dormant and removes it from the routing table when start() throws', async () => {
  spore('exploder', {
    'spore.yaml': 'kind: enzyme\nname: exploder\nseptum: "^1.0"\ncommands:\n  - name: boom\n    description: x\n    code: boom\n',
    'src/index.ts': [
      'export default {',
      '  create: () => ({',
      "    async start() { throw new Error('kaboom') },",
      '    async stop() {},',
      "    handlers: { boom: async (_inv, ctx) => { await ctx.reply({ text: 'should not run' }) } },",
      '  }),',
      '}',
    ].join('\n'),
  })
  const configFile = join(dir, 'mycelo.yaml')
  writeFileSync(configFile, `prefix: "/"\nspores: ${dir}\n`, 'utf8')

  const { registry } = await bootstrap(configFile)
  expect(registry.enzymes).toEqual([])
  expect(registry.dormant.find((d) => d.name === 'exploder')?.reason).toContain('kaboom')
  expect(registry.routes.has('boom')).toBe(false)
})

it("wires ctx.rhiza('mycelium') to the real, scope-gated API during an enzyme's start()", async () => {
  spore('channel', {
    'spore.yaml': 'kind: hypha\nname: channel\nseptum: "^1.0"\n',
    'src/index.ts': [
      'export default {',
      '  create: () => ({',
      '    connect: async () => {},',
      '    listen: () => {},',
      '    stop: async () => {},',
      '    send: async () => {},',
      '  }),',
      '}',
    ].join('\n'),
  })
  spore('admin', {
    'spore.yaml': [
      'kind: enzyme', 'name: admin', 'septum: "^0.4"',
      'requires:', '  - rhiza: mycelium', '    scopes: [plugins.read]',
      'commands:', '  - name: admin', '    description: x', '    code: admin', '',
    ].join('\n'),
    'src/index.ts': [
      'export default {',
      '  create: () => {',
      '    const observed = {}',
      '    return {',
      '      observed,',
      '      async start(ctx) { observed.plugins = ctx.rhiza("mycelium").listPlugins() },',
      '      async stop() {},',
      '      handlers: { admin: async () => {} },',
      '    }',
      '  },',
      '}',
    ].join('\n'),
  })
  const configFile = join(dir, 'mycelo.yaml')
  writeFileSync(configFile, `prefix: "/"\nspores: ${dir}\n`, 'utf8')

  const { registry } = await bootstrap(configFile)
  expect(registry.dormant).toEqual([])

  const admin = registry.enzymes.find((e) => e.name === 'admin')
  const observed = (admin?.instance as unknown as { observed: Record<string, unknown> }).observed
  // Hyphae connect before any enzyme starts (design §2.1), so 'channel' is already
  // germinated when 'admin' calls this from its own start().
  expect(observed.plugins).toEqual([
    { name: 'channel', kind: 'hypha', commands: [], state: 'germinated', enabled: true },
  ])
})

it("confines each enzyme's start() to its own resolved set and scopes, not a union across every enzyme", async () => {
  spore('mock', {
    'spore.yaml': 'kind: rhiza\nname: mock\nseptum: "^0.4"\n',
    'src/index.ts': [
      'export default {',
      '  create: () => ({',
      '    async start() {},',
      '    async stop() {},',
      "    health: async () => ({ state: 'healthy', checkedAt: new Date() }),",
      '    api: {},',
      '  }),',
      '}',
    ].join('\n'),
  })
  spore('other', {
    'spore.yaml': 'kind: rhiza\nname: other\nseptum: "^0.4"\n',
    'src/index.ts': [
      'export default {',
      '  create: () => ({',
      '    async start() {},',
      '    async stop() {},',
      "    health: async () => ({ state: 'healthy', checkedAt: new Date() }),",
      '    api: {},',
      '  }),',
      '}',
    ].join('\n'),
  })
  spore('alpha', {
    'spore.yaml': [
      'kind: enzyme', 'name: alpha', 'septum: "^0.4"',
      'requires:', '  - rhiza: mock', '  - rhiza: mycelium', '    scopes: [plugins.read]',
      'commands:', '  - name: alpha', '    description: x', '    code: alpha', '',
    ].join('\n'),
    'src/index.ts': [
      'export default {',
      '  create: () => {',
      '    const observed = {}',
      '    return {',
      '      observed,',
      '      async start(ctx) {',
      '        observed.hasOther = ctx.has("other")',
      '        try { ctx.rhiza("other") } catch (e) { observed.otherError = e.message }',
      '        const api = ctx.rhiza("mycelium")',
      '        observed.listPlugins = "listPlugins" in api',
      '        observed.health = "health" in api',
      '      },',
      '      async stop() {},',
      '      handlers: { alpha: async () => {} },',
      '    }',
      '  },',
      '}',
    ].join('\n'),
  })
  spore('beta', {
    'spore.yaml': [
      'kind: enzyme', 'name: beta', 'septum: "^0.4"',
      'requires:', '  - rhiza: other', '  - rhiza: mycelium', '    scopes: [health.read]',
      'commands:', '  - name: beta', '    description: x', '    code: beta', '',
    ].join('\n'),
    'src/index.ts': [
      'export default {',
      '  create: () => {',
      '    const observed = {}',
      '    return {',
      '      observed,',
      '      async start(ctx) {',
      '        observed.hasMock = ctx.has("mock")',
      '        try { ctx.rhiza("mock") } catch (e) { observed.mockError = e.message }',
      '        const api = ctx.rhiza("mycelium")',
      '        observed.listPlugins = "listPlugins" in api',
      '        observed.health = "health" in api',
      '      },',
      '      async stop() {},',
      '      handlers: { beta: async () => {} },',
      '    }',
      '  },',
      '}',
    ].join('\n'),
  })
  const configFile = join(dir, 'mycelo.yaml')
  writeFileSync(configFile, `prefix: "/"\nspores: ${dir}\n`, 'utf8')

  const { registry } = await bootstrap(configFile)
  expect(registry.dormant).toEqual([])

  const alpha = registry.enzymes.find((e) => e.name === 'alpha')
  const alphaObserved = (alpha?.instance as unknown as { observed: Record<string, unknown> }).observed
  expect(alphaObserved.hasOther).toBe(false)
  expect(alphaObserved.otherError).toContain("'other'")
  expect(alphaObserved.otherError).toContain('not declared')
  expect(alphaObserved.listPlugins).toBe(true)
  expect(alphaObserved.health).toBe(false)

  const beta = registry.enzymes.find((e) => e.name === 'beta')
  const betaObserved = (beta?.instance as unknown as { observed: Record<string, unknown> }).observed
  expect(betaObserved.hasMock).toBe(false)
  expect(betaObserved.mockError).toContain("'mock'")
  expect(betaObserved.mockError).toContain('not declared')
  expect(betaObserved.listPlugins).toBe(false)
  expect(betaObserved.health).toBe(true)
})

it("keeps the mycelium's plugin list consistent with bootstrap()'s own registry when listen() throws", async () => {
  spore('good', {
    'spore.yaml': 'kind: hypha\nname: good\nseptum: "^1.0"\n',
    'src/index.ts': [
      'export default {',
      '  create: () => ({',
      '    connect: async () => {},',
      '    listen: () => {},',
      '    stop: async () => {},',
      '    send: async () => {},',
      '  }),',
      '}',
    ].join('\n'),
  })
  spore('bad', {
    'spore.yaml': 'kind: hypha\nname: bad\nseptum: "^1.0"\n',
    'src/index.ts': [
      'export default {',
      '  create: () => ({',
      '    connect: async () => {},',
      "    listen: () => { throw new Error('boom') },",
      '    stop: async () => {},',
      '    send: async () => {},',
      '  }),',
      '}',
    ].join('\n'),
  })
  spore('admin', {
    'spore.yaml': [
      'kind: enzyme', 'name: admin', 'septum: "^0.4"',
      'requires:', '  - rhiza: mycelium', '    scopes: [plugins.read]',
      'commands:', '  - name: probe', '    description: x', '    code: probe', '',
    ].join('\n'),
    'src/index.ts': [
      'export default {',
      '  create: () => {',
      '    const observed = {}',
      '    return {',
      '      observed,',
      '      handlers: { probe: async (_inv, ctx) => { observed.plugins = ctx.rhiza("mycelium").listPlugins() } },',
      '    }',
      '  },',
      '}',
    ].join('\n'),
  })
  const configFile = join(dir, 'mycelo.yaml')
  // owner matches message()'s fixed sender ('local'), so /probe is authorized (phase 4).
  writeFileSync(configFile, `prefix: "/"\nspores: ${dir}\nowner:\n  channel: good\n  userId: local\n`, 'utf8')

  const { registry, bus } = await bootstrap(configFile)
  expect(registry.hyphae.map((h) => h.name)).toEqual(['good'])
  expect(registry.dormant.find((d) => d.name === 'bad')?.reason).toContain('boom')

  await bus.deliver('good', message('good', '/probe'))
  const admin = registry.enzymes.find((e) => e.name === 'admin')
  const observed = (admin?.instance as unknown as { observed: Record<string, unknown> }).observed
  // 'bad' failed listen() and bootstrap()'s own registry demotes it to dormant-only
  // (registry.hyphae above); the mycelium's own view must agree, not list it twice.
  expect(observed.plugins).toEqual([
    { name: 'good', kind: 'hypha', commands: [], state: 'germinated', enabled: true },
    { name: 'admin', kind: 'enzyme', commands: ['probe'], state: 'germinated', enabled: true },
    { name: 'bad', commands: [], state: 'dormant', reason: 'boom', enabled: true },
  ])
})

// The same property as the test above, for the one kind whose filtering was missing: an
// inhibitor listed both germinated and dormant reports a broken gate as healthy.
it("keeps the mycelium's plugin list consistent when an inhibitor's start() throws", async () => {
  spore('good', {
    'spore.yaml': 'kind: hypha\nname: good\nseptum: "^1.0"\n',
    'src/index.ts': [
      'export default {',
      '  create: () => ({',
      '    connect: async () => {},',
      '    listen: () => {},',
      '    stop: async () => {},',
      '    send: async () => {},',
      '  }),',
      '}',
    ].join('\n'),
  })
  // Advisory, so admission still lets /probe through and the listing can be observed.
  spore('softgate', {
    'spore.yaml': 'kind: inhibitor\nname: softgate\nseptum: "^1.0"\n',
    'src/index.ts': [
      'export default {',
      '  create: () => ({',
      "    start: () => { throw new Error('gate cannot start') },",
      '    stop: async () => {},',
      '    inspect: async () => ({ allow: true }),',
      '  }),',
      '}',
    ].join('\n'),
  })
  spore('admin', {
    'spore.yaml': [
      'kind: enzyme', 'name: admin', 'septum: "^0.4"',
      'requires:', '  - rhiza: mycelium', '    scopes: [plugins.read]',
      'commands:', '  - name: probe', '    description: x', '    code: probe', '',
    ].join('\n'),
    'src/index.ts': [
      'export default {',
      '  create: () => {',
      '    const observed = {}',
      '    return {',
      '      observed,',
      '      handlers: { probe: async (_inv, ctx) => { observed.plugins = ctx.rhiza("mycelium").listPlugins() } },',
      '    }',
      '  },',
      '}',
    ].join('\n'),
  })
  const configFile = join(dir, 'mycelo.yaml')
  writeFileSync(configFile, `prefix: "/"\nspores: ${dir}\nowner:\n  channel: good\n  userId: local\n`, 'utf8')

  const { registry, bus } = await bootstrap(configFile)
  expect(registry.inhibitors).toEqual([])
  expect(registry.dormant.find((d) => d.name === 'softgate')?.reason).toContain('gate cannot start')

  await bus.deliver('good', message('good', '/probe'))
  const admin = registry.enzymes.find((e) => e.name === 'admin')
  const observed = (admin?.instance as unknown as { observed: Record<string, unknown> }).observed
  const listed = observed.plugins as Record<string, unknown>[]
  expect(listed.filter((p) => p.name === 'softgate')).toEqual([
    { name: 'softgate', commands: [], state: 'dormant', reason: 'gate cannot start', enabled: true },
  ])
})

it('routes onUnrouted through the shared send path, so an unregistered channel is a contained, logged failure rather than a silent no-op', async () => {
  spore('good', {
    'spore.yaml': 'kind: hypha\nname: good\nseptum: "^1.0"\n',
    'src/index.ts': [
      'export default {',
      '  create: () => ({',
      '    connect: async () => {},',
      '    listen: () => {},',
      '    stop: async () => {},',
      '    send: async () => {},',
      '  }),',
      '}',
    ].join('\n'),
  })
  const configFile = join(dir, 'mycelo.yaml')
  writeFileSync(configFile, `prefix: "/"\nspores: ${dir}\n`, 'utf8')

  const { bus } = await bootstrap(configFile)
  const logs: string[] = []
  const spy = spyOn(console, 'log').mockImplementation((line: unknown) => { logs.push(String(line)) })
  try {
    // 'phantom' is not a registered hypha: the old direct hypha?.instance.send() call
    // silently did nothing here, unlike every other send in the bus.
    await bus.deliver('phantom', message('phantom', '/nope'))
  } finally {
    spy.mockRestore()
  }
  expect(logs.some((l) => l.includes("no hypha named 'phantom'"))).toBe(true)
})

it("names a failed start(), not a missing installation, when ctx.rhiza() reaches a mandatory dependency that failed to start", async () => {
  spore('latefail', {
    'spore.yaml': 'kind: rhiza\nname: latefail\nseptum: "^0.4"\n',
    'src/index.ts': [
      'export default {',
      '  create: () => ({',
      "    async start() { throw new Error('boom') },",
      '    async stop() {},',
      "    health: async () => ({ state: 'healthy', checkedAt: new Date() }),",
      '    api: {},',
      '  }),',
      '}',
    ].join('\n'),
  })
  spore('user', {
    'spore.yaml': [
      'kind: enzyme', 'name: user', 'septum: "^0.4"',
      'requires:', '  - rhiza: latefail',
      'commands:', '  - name: user', '    description: x', '    code: user', '',
    ].join('\n'),
    'src/index.ts': [
      'export default {',
      '  create: () => {',
      '    const observed = {}',
      '    return {',
      '      observed,',
      '      async start(ctx) {',
      '        observed.has = ctx.has("latefail")',
      '        try { ctx.rhiza("latefail") } catch (e) { observed.rhizaError = e.message }',
      '      },',
      '      async stop() {},',
      '      handlers: { user: async () => {} },',
      '    }',
      '  },',
      '}',
    ].join('\n'),
  })
  const configFile = join(dir, 'mycelo.yaml')
  writeFileSync(configFile, `prefix: "/"\nspores: ${dir}\n`, 'utf8')

  const { registry } = await bootstrap(configFile)
  // The cascade is deliberately not implemented (deferred): 'user' still starts and
  // is not marked dormant even though its mandatory dependency failed.
  expect(registry.dormant.find((d) => d.name === 'latefail')?.reason).toContain('boom')
  expect(registry.enzymes.map((e) => e.name)).toEqual(['user'])

  const user = registry.enzymes.find((e) => e.name === 'user')
  const observed = (user?.instance as unknown as { observed: Record<string, unknown> }).observed
  expect(observed.has).toBe(true)
  expect(observed.rhizaError).toContain("'latefail'")
  expect(observed.rhizaError).toContain('failed to start')
  expect(observed.rhizaError).not.toContain('not installed')
})

it("counts and names a rhiza in the germination banner, not just hyphae and enzymes", async () => {
  spore('channel', {
    'spore.yaml': 'kind: hypha\nname: channel\nseptum: "^1.0"\ncapabilities: []\n',
    'src/index.ts': [
      'export default {',
      '  create: () => ({',
      '    connect: async () => {},',
      '    listen: () => {},',
      '    stop: async () => {},',
      '    send: async () => {},',
      '  }),',
      '}',
    ].join('\n'),
  })
  spore('store', {
    'spore.yaml': 'kind: rhiza\nname: store\nseptum: "^0.4"\n',
    'src/index.ts': [
      'export default {',
      '  create: () => ({',
      '    start: async () => {},',
      '    stop: async () => {},',
      "    health: async () => ({ state: 'healthy', checkedAt: new Date() }),",
      '    api: {},',
      '  }),',
      '}',
    ].join('\n'),
  })
  const configFile = join(dir, 'mycelo.yaml')
  writeFileSync(configFile, `prefix: "/"\nspores: ${dir}\n`, 'utf8')

  const { registry } = await bootstrap(configFile)
  expect(registry.dormant).toEqual([])
  expect(germinationBanner(registry)).toBe('germinated 2 spores (channel, store)')
})

// The next three exercise both halves of the brokenEnforcing merge (design §7) through
// the real bootstrap(). Assertions read mycelium.admission directly, since bus.ts does
// not consult it until task 11.

it('admits when an enforcing inhibitor starts cleanly', async () => {
  spore('cleangate', {
    'spore.yaml': 'kind: inhibitor\nname: cleangate\nseptum: "^1.0"\nenforcing: true\n',
    'src/index.ts': [
      'export default {',
      '  create: () => ({',
      '    async start() {},',
      '    async stop() {},',
      '    inspect: () => Promise.resolve({ allow: true }),',
      '  }),',
      '}',
    ].join('\n'),
  })
  const configFile = join(dir, 'mycelo.yaml')
  writeFileSync(configFile, `prefix: "/"\nspores: ${dir}\n`, 'utf8')

  const { registry, admission } = await bootstrap(configFile)
  expect(registry.dormant).toEqual([])
  expect(registry.inhibitors.map((i) => i.name)).toEqual(['cleangate'])
  expect(await admission.admit(message('console', '/ping'))).toEqual({ allow: true })
})

it('refuses all traffic when an enforcing inhibitor throws in start() — the startup half of the design §7 merge', async () => {
  spore('throwgate', {
    'spore.yaml': 'kind: inhibitor\nname: throwgate\nseptum: "^1.0"\nenforcing: true\n',
    'src/index.ts': [
      'export default {',
      '  create: () => ({',
      "    async start() { throw new Error('boom') },",
      '    async stop() {},',
      '    inspect: () => Promise.resolve({ allow: true }),',
      '  }),',
      '}',
    ].join('\n'),
  })
  const configFile = join(dir, 'mycelo.yaml')
  writeFileSync(configFile, `prefix: "/"\nspores: ${dir}\n`, 'utf8')

  const { registry, admission } = await bootstrap(configFile)
  expect(registry.inhibitors).toEqual([])
  expect(registry.dormant.find((d) => d.name === 'throwgate')?.reason).toContain('boom')
  expect((await admission.admit(message('console', '/ping'))).allow).toBe(false)
})

it('refuses all traffic when an enforcing inhibitor is dormant from a rejected config — the germination half of the design §7 merge', async () => {
  spore('badconfiggate', {
    'spore.yaml': 'kind: inhibitor\nname: badconfiggate\nseptum: "^1.0"\nenforcing: true\n',
    'src/index.ts': [
      'export default {',
      '  configSchema: { safeParse: () => ({ success: false, error: "groupId is required" }) },',
      '  create: () => ({ inspect: () => Promise.resolve({ allow: true }) }),',
      '}',
    ].join('\n'),
  })
  const configFile = join(dir, 'mycelo.yaml')
  writeFileSync(configFile, `prefix: "/"\nspores: ${dir}\n`, 'utf8')

  const { registry, admission } = await bootstrap(configFile)
  expect(registry.inhibitors).toEqual([])
  expect(registry.dormant.find((d) => d.name === 'badconfiggate')?.reason).toContain('groupId')
  expect((await admission.admit(message('console', '/ping'))).allow).toBe(false)
})
