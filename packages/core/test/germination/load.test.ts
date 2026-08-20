import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'bun:test'
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
  const location = discover([dir]).find((l) => l.directory === name)!
  const r = readManifest(location)
  if (isFailure(r)) throw new Error(r.reason)
  return r
}

/**
 * Imports a spore's entry point in a subprocess, the way the `local` driver does.
 * Runs under whatever `process.execPath` is — Bun during the suite.
 */
async function loadInSubprocess(sporePath: string): Promise<{ success: boolean; output: string; error?: string }> {
  const candidates = ['src/index.ts', 'index.ts', 'dist/index.js', 'index.js']
  let entryFile: string | null = null
  for (const candidate of candidates) {
    const fullPath = join(sporePath, candidate)
    if (existsSync(fullPath)) {
      entryFile = fullPath
      break
    }
  }
  if (!entryFile) throw new Error(`no entry point found in ${sporePath}`)

  const script = `
const entry = ${JSON.stringify(entryFile)}
const spore = await import('file://' + entry)
const module = spore.default
if (typeof module.create !== 'function') throw new Error('no create()')
const result = module.create()
console.log('success:', result.name ?? 'ok')
`
  const tmpScript = join(tmpdir(), `loader-test-${Date.now()}.mjs`)
  try {
    writeFileSync(tmpScript, script, 'utf8')
    const output = execFileSync(process.execPath, [tmpScript], { encoding: 'utf8', stdio: 'pipe' })
    return { success: true, output }
  } catch (e) {
    const error = (e as { stderr?: unknown }).stderr
    const stderr = Buffer.isBuffer(error) ? error.toString('utf8') : typeof error === 'string' ? error : (e as Error).message
    return { success: false, output: '', error: stderr }
  } finally {
    rmSync(tmpScript, { force: true })
  }
}

it('resolves entry point and validates create() duck-type', async () => {
  spore('probe', {
    'spore.yaml': HYPHA_MANIFEST,
    'src/index.ts': 'const name: string = "probe"\nexport default { create: () => ({ name }) }\n',
  })
  const module = await loadModule(await read('probe'))
  if (module === null) throw new Error('expected a module')
  expect((module.create() as { name: string }).name).toBe('probe')
})

it('refuses a spore with no entry point', async () => {
  spore('empty', { 'spore.yaml': HYPHA_MANIFEST })
  expect(loadModule(await read('empty'))).rejects.toThrow('no entry point')
})

it('refuses a default export with no create()', async () => {
  spore('bad', {
    'spore.yaml': HYPHA_MANIFEST,
    'src/index.ts': 'export default { nope: true }\n',
  })
  expect(loadModule(await read('bad'))).rejects.toThrow('create()')
})

it('loads an erasable TypeScript spore via a subprocess', async () => {
  spore('erasable', {
    'spore.yaml': HYPHA_MANIFEST,
    'src/index.ts': `
type User = { name: string }
const user = { name: 'alice' } satisfies User
type T = typeof user
export default { create: () => ({ success: true }) }
    `.trim(),
  })
  const result = await loadInSubprocess(join(dir, 'erasable'))
  if (!result.success) {
    console.error('Subprocess error:', result.error)
  }
  expect(result.success).toBe(true)
  expect(result.output).toContain('success:')
})

it('loads non-erasable syntax like enum, which Bun compiles rather than strips', async () => {
  spore('nonerasable', {
    'spore.yaml': HYPHA_MANIFEST,
    'src/index.ts': 'export enum Bad { A }\nexport default { create: () => ({}) }\n',
  })
  const result = await loadInSubprocess(join(dir, 'nonerasable'))
  expect(result.success).toBe(true)
  expect(result.output).toContain('success:')
})

it('needs no module when every command answers with text', async () => {
  spore('textonly', {
    'spore.yaml': 'kind: enzyme\nname: textonly\nseptum: "^1.0"\ncommands:\n  - name: hi\n    description: Greet\n    respond: hello\n',
  })
  expect(await loadModule(await read('textonly'))).toBeNull()
})

it('still refuses a spore with a code command and no entry point', async () => {
  spore('needy', {
    'spore.yaml': 'kind: enzyme\nname: needy\nseptum: "^1.0"\ncommands:\n  - name: hi\n    description: Greet\n    code: handleHi\n',
  })
  expect(loadModule(await read('needy'))).rejects.toThrow('no entry point')
})

it('refuses a spore mixing respond and code commands with no entry point', async () => {
  spore('mixed', {
    'spore.yaml': 'kind: enzyme\nname: mixed\nseptum: "^1.0"\ncommands:\n  - name: hi\n    description: Greet\n    respond: hello\n  - name: bye\n    description: Farewell\n    code: handleBye\n',
  })
  expect(loadModule(await read('mixed'))).rejects.toThrow('no entry point')
})

it('loads an entry point that is present even when no command needs it', async () => {
  spore('extra', {
    'spore.yaml': 'kind: enzyme\nname: extra\nseptum: "^1.0"\ncommands:\n  - name: hi\n    description: Greet\n    respond: hello\n',
    'src/index.ts': 'export default { create: () => ({ handlers: {} }) }\n',
  })
  expect(await loadModule(await read('extra'))).not.toBeNull()
})

it('loads a spore made of two files that import each other with .js specifiers', async () => {
  spore('multifile', {
    'spore.yaml': HYPHA_MANIFEST,
    'src/greeting.ts': 'export const who = "second file"\n',
    'src/index.ts': "import { who } from './greeting.js'\nexport default { create: () => ({ name: who }) }\n",
  })
  const result = await loadInSubprocess(join(dir, 'multifile'))
  expect(result.success).toBe(true)
  expect(result.output).toContain('second file')
})
