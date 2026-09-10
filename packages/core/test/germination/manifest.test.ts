import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'bun:test'
import { discover } from '../../src/germination/discover.js'
import { isFailure, manifestFailureReason, manifestFailureRefusal, readManifest } from '../../src/germination/manifest.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mycelo-man-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

function spore(name: string, yaml: string): void {
  mkdirSync(join(dir, name), { recursive: true })
  writeFileSync(join(dir, name, 'spore.yaml'), yaml, 'utf8')
}

const VALID = 'kind: enzyme\nname: ping\nseptum: "^1.0"\ncommands:\n  - name: ping\n    description: Health check\n    respond: pong\n'

it('parses a valid manifest', () => {
  spore('ping', VALID)
  const read = readManifest(discover([dir])[0]!)
  expect(isFailure(read)).toBe(false)
  if (!isFailure(read)) expect(read.manifest.name).toBe('ping')
})

it('reports invalid YAML as a failure, never a throw', () => {
  spore('broken', 'kind: [unclosed\n')
  const read = readManifest(discover([dir])[0]!)
  expect(isFailure(read)).toBe(true)
  if (isFailure(read)) expect(read.reason).toContain('cannot read spore.yaml')
})

it('reports a schema violation with the offending field', () => {
  spore('nameless', 'kind: enzyme\nseptum: "^1.0"\ncommands: []\n')
  const read = readManifest(discover([dir])[0]!)
  expect(isFailure(read)).toBe(true)
  // Zod's message text ("Invalid input: expected string, received undefined") is
  // identical whichever required string field is missing, so the field name has to
  // come from the path, not the message — this is what distinguishes the assertion
  // from one that would pass against any generic schema-violation reason.
  if (isFailure(read)) {
    expect(read.reason).toContain("'name'")
    expect(read.refusal.key).toBe('refusal.germination.invalidManifest')
    expect(read.refusal.params?.['path']).toBe('name')
  }
})

it('names the path for a lookalike error that is not an instance of this core\'s ManifestError', () => {
  class OtherManifestError extends Error {
    constructor(message: string, readonly path: string) { super(message) }
  }
  const reason = manifestFailureReason(new OtherManifestError('bad', 'requires.0.scopes.0'))
  expect(reason).toBe("invalid manifest at 'requires.0.scopes.0': bad")
})

it('refuses unreadable YAML with the plugin refusal key, naming the directory', () => {
  spore('broken', 'kind: [unclosed\n')
  const failure = readManifest(discover([dir])[0]!)
  expect(isFailure(failure)).toBe(true)
  if (!isFailure(failure)) return
  expect(failure.refusal.key).toBe('refusal.plugin.unreadableManifest')
  // The directory, because no validated name exists at this point in the lifecycle.
  expect(failure.refusal.params?.['plugin']).toBe('broken')
  const detail = String(failure.refusal.params?.['detail'])
  expect(detail.length).toBeGreaterThan(0)
  // Ties the ref to the sentence rather than to the parser's wording, which is not ours.
  expect(failure.reason).toBe(`cannot read spore.yaml: ${detail}`)
})

it("names the manifest path when Zod's issue carries one", () => {
  const refusal = manifestFailureRefusal({ path: 'kind', message: 'Invalid input' })
  expect(refusal.key).toBe('refusal.germination.invalidManifest')
  expect(refusal.params).toEqual({ path: 'kind', detail: 'Invalid input' })
})

// The ternary's else branch, and the only one of the three with no wrapping sentence today.
it('falls back to the no-path key when the issue carries no path', () => {
  const refusal = manifestFailureRefusal(new Error('Invalid input'))
  expect(refusal.key).toBe('refusal.germination.invalidManifestNoPath')
  expect(refusal.params).toEqual({ detail: 'Invalid input' })
})

// `reason` survives for inoculate alone (ruling R8-a), so nothing but this holds the two
// spellings of one verdict together — and the path is what the ref would silently drop.
it('keeps reason and refusal saying the same thing', () => {
  const e = { path: 'kind', message: 'Invalid input' }
  expect(manifestFailureReason(e)).toBe("invalid manifest at 'kind': Invalid input")
  expect(manifestFailureRefusal(e).params).toEqual({ path: 'kind', detail: 'Invalid input' })
})
