import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { discover } from '../../src/germination/discover.js'
import { isFailure, readManifest } from '../../src/germination/manifest.js'
import { loadModule } from '../../src/germination/load.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mycelo-load-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

function spore(name: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const file = join(dir, name, rel)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, content, 'utf8')
  }
}

const HYPHA_MANIFEST = 'kind: hypha\nname: probe\nseptum: "^1.0"\n'

async function read(name: string) {
  const location = discover(dir).find((l) => l.directory === name)!
  const r = readManifest(location)
  if (isFailure(r)) throw new Error(r.reason)
  return r
}

it('imports an unbundled TypeScript spore', async () => {
  spore('probe', {
    'spore.yaml': HYPHA_MANIFEST,
    'src/index.ts': 'const name: string = "probe"\nexport default { create: () => ({ name }) }\n',
  })
  const module = await loadModule(await read('probe'))
  expect((module.create() as { name: string }).name).toBe('probe')
})

it('refuses a spore with no entry point', async () => {
  spore('empty', { 'spore.yaml': HYPHA_MANIFEST })
  await expect(loadModule(await read('empty'))).rejects.toThrow('no entry point')
})

it('refuses a default export with no create()', async () => {
  spore('bad', {
    'spore.yaml': HYPHA_MANIFEST,
    'src/index.ts': 'export default { nope: true }\n',
  })
  await expect(loadModule(await read('bad'))).rejects.toThrow('create()')
})
