import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { BootstrapError, loadBootstrap } from '../src/config.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mycelo-cfg-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

function writeConfig(content: string): string {
  const file = join(dir, 'mycelo.yaml')
  writeFileSync(file, content, 'utf8')
  return file
}

it('defaults every field when the file is absent', () => {
  const config = loadBootstrap(join(dir, 'mycelo.yaml'))
  expect(config.prefix).toBe('/')
  expect(config.sporesDir).toBe(resolve(dir, 'fixtures'))
})

it('reads what the file declares', () => {
  const file = writeConfig('prefix: "!"\nspores: ./plugins\n')
  const config = loadBootstrap(file)
  expect(config.prefix).toBe('!')
  expect(config.sporesDir).toBe(resolve(dir, 'plugins'))
})

it('ignores fields later phases will add', () => {
  const file = writeConfig('prefix: "/"\nui:\n  port: 8730\n')
  expect(loadBootstrap(file).prefix).toBe('/')
})

it('names the offending path when a field has the wrong type', () => {
  const file = writeConfig('prefix: 42\n')
  expect(() => loadBootstrap(file)).toThrow(BootstrapError)
})

describe('loadBootstrap, phase 4 fields', () => {
  it('defaults the database beside the config file', () => {
    const file = writeConfig('prefix: "!"\n')
    const config = loadBootstrap(file)
    expect(config.database).toBe('./mycelo.db')
    expect(config.databaseFile).toBe(resolve(file, '..', './mycelo.db'))
  })

  it('resolves a relative database path against the config file, not the cwd', () => {
    const file = writeConfig('database: ./data/state.db\n')
    expect(loadBootstrap(file).databaseFile).toBe(resolve(file, '..', './data/state.db'))
  })

  it('reads the owner identity', () => {
    const file = writeConfig('owner:\n  channel: console\n  userId: alice\n')
    expect(loadBootstrap(file).owner).toEqual({ channel: 'console', userId: 'alice' })
  })

  it('leaves owner undefined when the key is absent', () => {
    expect(loadBootstrap(writeConfig('prefix: "/"\n')).owner).toBeUndefined()
  })

  it('rejects a partial owner rather than accepting half an identity', () => {
    const file = writeConfig('owner:\n  channel: console\n')
    expect(() => loadBootstrap(file)).toThrow(BootstrapError)
  })

  it('reads defaultRole and keeps plugins opaque', () => {
    const file = writeConfig('defaultRole: guest\nplugins:\n  gate:\n    groupId: household\n')
    const config = loadBootstrap(file)
    expect(config.defaultRole).toBe('guest')
    expect(config.plugins['gate']).toEqual({ groupId: 'household' })
  })

  it('defaults plugins to an empty record', () => {
    expect(loadBootstrap(writeConfig('prefix: "/"\n')).plugins).toEqual({})
  })
})
