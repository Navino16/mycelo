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
