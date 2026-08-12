import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'bun:test'
import { bootstrap } from '../src/mycelium.js'

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
