import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { germinate } from '../../src/germination/germinate.js'
import { createLogger } from '../../src/support/logger.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mycelo-germ-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

function spore(name: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const file = join(dir, name, rel)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, content, 'utf8')
  }
}

it('refuses an instance that does not implement its kind', async () => {
  spore('liar', {
    'spore.yaml': 'kind: hypha\nname: liar\nseptum: "^1.0"\n',
    'src/index.ts': 'export default { create: () => ({ start: 1 }) }\n',
  })
  const registry = await germinate(dir, createLogger())
  expect(registry.hyphae).toEqual([])
  expect(registry.dormant[0]?.reason).toContain('create() returned no start, stop, send')
})

it('refuses a spore declaring requires, which phase 3 resolves', async () => {
  spore('needy', {
    'spore.yaml': 'kind: enzyme\nname: needy\nseptum: "^1.0"\ncommands:\n  - name: needy\n    description: x\nrequires:\n  - rhiza: radarr\n',
    'enzyme.yaml': 'responses:\n  needy: hi\n',
  })
  const registry = await germinate(dir, createLogger())
  expect(registry.enzymes).toEqual([])
  expect(registry.dormant[0]?.reason).toContain('phase 3')
})

it('keeps germinating after one spore fails', async () => {
  spore('broken', { 'spore.yaml': 'kind: [unclosed\n' })
  spore('ping', {
    'spore.yaml': 'kind: enzyme\nname: ping\nseptum: "^1.0"\ncommands:\n  - name: ping\n    description: x\n',
    'enzyme.yaml': 'responses:\n  ping: pong\n',
  })
  const registry = await germinate(dir, createLogger())
  expect(registry.enzymes.map((e) => e.name)).toEqual(['ping'])
  expect(registry.dormant).toHaveLength(1)
})
