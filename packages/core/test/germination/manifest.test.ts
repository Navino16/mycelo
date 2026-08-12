import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'bun:test'
import { discover } from '../../src/germination/discover.js'
import { isFailure, manifestFailureReason, readManifest } from '../../src/germination/manifest.js'

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
  const read = readManifest(discover(dir)[0]!)
  expect(isFailure(read)).toBe(false)
  if (!isFailure(read)) expect(read.manifest.name).toBe('ping')
})

it('reports invalid YAML as a failure, never a throw', () => {
  spore('broken', 'kind: [unclosed\n')
  const read = readManifest(discover(dir)[0]!)
  expect(isFailure(read)).toBe(true)
  if (isFailure(read)) expect(read.reason).toContain('cannot read spore.yaml')
})

it('reports a schema violation with the offending field', () => {
  spore('nameless', 'kind: enzyme\nseptum: "^1.0"\ncommands: []\n')
  const read = readManifest(discover(dir)[0]!)
  expect(isFailure(read)).toBe(true)
  // Zod's message text ("Invalid input: expected string, received undefined") is
  // identical whichever required string field is missing, so the field name has to
  // come from the path, not the message — this is what distinguishes the assertion
  // from one that would pass against any generic schema-violation reason.
  if (isFailure(read)) expect(read.reason).toContain("'name'")
})

it('names the path for a lookalike error that is not an instance of this core\'s ManifestError', () => {
  class OtherManifestError extends Error {
    constructor(message: string, readonly path: string) { super(message) }
  }
  const reason = manifestFailureReason(new OtherManifestError('bad', 'requires.0.scopes.0'))
  expect(reason).toBe("invalid manifest at 'requires.0.scopes.0': bad")
})
