import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
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

it('keeps other hyphae starting when one throws in start(), and marks it dormant', async () => {
  spore('bad', {
    'spore.yaml': 'kind: hypha\nname: bad\nseptum: "^1.0"\n',
    'src/index.ts': [
      'export default {',
      '  create: () => ({',
      "    start: () => { throw new Error('boom') },",
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
      '    start: async () => {},',
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

it('invokes Enzyme.start() with a working push()/capabilitiesOf(), and has()/rhiza()/on() matching phase 3', async () => {
  spore('good', {
    'spore.yaml': 'kind: hypha\nname: good\nseptum: "^1.0"\n',
    'src/index.ts': [
      'const sent = []',
      'export default {',
      '  create: () => ({',
      '    sent,',
      '    start: async () => {},',
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
  expect(observed.has).toBe(false)
  expect(observed.rhizaError).toContain('phase 3')
  expect(observed.onError).toContain('phase 3')
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
