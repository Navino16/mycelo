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
  try {
    loadBootstrap(file)
    throw new Error('loadBootstrap should have thrown')
  } catch (e) {
    expect((e as BootstrapError).path).toBe('plugins')
    // index.ts prints the message and nothing else, and "expected never, received object"
    // names neither the field nor where the settings went.
    expect((e as BootstrapError).message).toContain('plugins')
    expect((e as BootstrapError).message).toContain('database')
  }
})

it('names the offending path in the message, not only in .path', () => {
  const file = withYaml('prefix: 42\n')
  try {
    loadBootstrap(file)
    throw new Error('loadBootstrap should have thrown')
  } catch (e) {
    expect((e as BootstrapError).message).toContain('prefix')
  }
})

it('a bootstrap without plugins: still loads', () => {
  const file = withYaml('prefix: "!"\n')
  expect(loadBootstrap(file).prefix).toBe('!')
})
