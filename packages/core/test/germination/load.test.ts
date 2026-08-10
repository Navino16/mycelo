import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
const ENZYME_MANIFEST = 'kind: enzyme\nname: responder\nseptum: "^1.0"\ncommands:\n  - name: greet\n    description: Greet\n'

async function read(name: string) {
  const location = discover(dir).find((l) => l.directory === name)!
  const r = readManifest(location)
  if (isFailure(r)) throw new Error(r.reason)
  return r
}

/**
 * Tests that a TypeScript spore can be imported via plain node, proving the
 * type-stripping loader handles erasable TypeScript syntax but rejects non-erasable.
 *
 * This directly imports the spore's entry point without using loadModule(),
 * simulating what the local driver does: straight TypeScript import.
 */
async function loadInSubprocess(sporePath: string): Promise<{ success: boolean; output: string; error?: string }> {
  // The subprocess will import the spore directly as a test of Node's type-stripping.
  // First, find the entry point in the spore directory.
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

// Tests the plumbing: path resolution, entry-point precedence, and duck-typed create() check.
// Does NOT test that the type-stripping loader itself rejects non-erasable syntax (Vitest's
// esbuild transform accepts it). The subprocess tests below cover the actual loader behavior.
it('resolves entry point and validates create() duck-type', async () => {
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

// Subprocess tests: verify the type-stripping loader behavior (not Vitest's transform).
// These exercise Node's actual ESM loader without any build-step transform in the way.

it('loads an erasable TypeScript spore via plain node (type-stripping loader)', async () => {
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

it('rejects non-erasable syntax like enum via plain node', async () => {
  spore('nonerasable', {
    'spore.yaml': HYPHA_MANIFEST,
    'src/index.ts': 'export enum Bad { A }\nexport default { create: () => ({}) }\n',
  })
  const result = await loadInSubprocess(join(dir, 'nonerasable'))
  expect(result.success).toBe(false)
  expect(result.error).toMatch(/ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX|error|enum/i)
})

// Declarative enzymes take precedence over code entries when both exist.
// This is the intended behavior: a plugin author may have dead code without realizing it.
it('uses enzyme.yaml when both enzyme.yaml and code entry exist', async () => {
  spore('dual', {
    'spore.yaml': ENZYME_MANIFEST,
    'enzyme.yaml': 'responses:\n  greet: hello\n',
    'src/index.ts': 'throw new Error("this code should never run")\n',
  })
  const module = await loadModule(await read('dual'))
  // Calling create() on an enzyme module returns the enzyme, not a throw.
  const enzyme = module.create()
  expect(enzyme).toHaveProperty('handle')
})
