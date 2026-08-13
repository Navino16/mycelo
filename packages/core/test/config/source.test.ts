import { expect, it } from 'bun:test'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BootstrapError, loadBootstrap } from '../../src/config.js'

function withYaml(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'mycelo-'))
  const file = join(dir, 'mycelo.yaml')
  writeFileSync(file, body)
  return file
}

it('a stale plugins: block is rejected, never ignored', () => {
  const file = withYaml('prefix: "/"\nplugins:\n  radarr:\n    url: http://x\n')
  // Zod strips unknown keys, so silence here would mean an operator's settings vanish
  // with no diagnostic after the source moved to the database.
  expect(() => loadBootstrap(file)).toThrow(BootstrapError)
})

it('a bootstrap without plugins: still loads', () => {
  const file = withYaml('prefix: "!"\n')
  expect(loadBootstrap(file).prefix).toBe('!')
})
