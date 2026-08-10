import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { discover } from '../../src/germination/discover.js'
import { isFailure, readManifest } from '../../src/germination/manifest.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mycelo-man-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

function spore(name: string, yaml: string): void {
  mkdirSync(join(dir, name), { recursive: true })
  writeFileSync(join(dir, name, 'spore.yaml'), yaml, 'utf8')
}

const VALID = 'kind: enzyme\nname: ping\nseptum: "^1.0"\ncommands:\n  - name: ping\n    description: Health check\n'

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
})
