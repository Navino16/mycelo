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

// BootstrapError.message is Zod's generic text, identical for any field of that type, so
// `.path` is the only thing that tells an operator which line to fix. Asserted, not implied.
it('names the offending path when a field has the wrong type', () => {
  const file = writeConfig('prefix: 42\n')
  expect(() => loadBootstrap(file)).toThrow(BootstrapError)
  try {
    loadBootstrap(file)
    throw new Error('loadBootstrap should have thrown')
  } catch (e) {
    expect((e as BootstrapError).path).toBe('prefix')
  }
})

it('names the offending path inside a nested object', () => {
  const file = writeConfig('owner:\n  channel: console\n  userId: 42\n')
  try {
    loadBootstrap(file)
    throw new Error('loadBootstrap should have thrown')
  } catch (e) {
    expect((e as BootstrapError).path).toBe('owner.userId')
  }
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

  it('reads defaultRole', () => {
    const file = writeConfig('defaultRole: guest\n')
    const config = loadBootstrap(file)
    expect(config.defaultRole).toBe('guest')
  })
})

describe('defaultLocale', () => {
  it("defaults to 'en' when the file says nothing", () => {
    const file = writeConfig('prefix: "!"\n')
    expect(loadBootstrap(file).defaultLocale).toBe('en')
  })

  it('canonicalises what the operator wrote', () => {
    const file = writeConfig('defaultLocale: fr-fr\n')
    expect(loadBootstrap(file).defaultLocale).toBe('fr-FR')
  })

  it('refuses an invalid tag at boot, naming the field', () => {
    const file = writeConfig('defaultLocale: "not a locale"\n')
    expect(() => loadBootstrap(file)).toThrow(/not a locale/)
  })
})

describe('the ui block', () => {
  it('defaults every field when the block is absent', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'mycelo-ui-')), 'mycelo.yaml')
    writeFileSync(file, 'prefix: "/"\n', 'utf8')
    expect(loadBootstrap(file).ui).toEqual({
      bind: '127.0.0.1', port: 8730, trustProxy: false, resetAccount: false,
    })
  })

  it('takes a partial block and defaults the rest', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'mycelo-ui-')), 'mycelo.yaml')
    writeFileSync(file, 'ui:\n  port: 9000\n  trustProxy: true\n', 'utf8')
    expect(loadBootstrap(file).ui).toEqual({
      bind: '127.0.0.1', port: 9000, trustProxy: true, resetAccount: false,
    })
  })

  it('names the field when a port is out of range', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'mycelo-ui-')), 'mycelo.yaml')
    writeFileSync(file, 'ui:\n  port: 70000\n', 'utf8')
    expect(() => loadBootstrap(file)).toThrow(/ui\.port/)
  })
})
