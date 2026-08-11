import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { BootstrapError, loadBootstrap } from '../src/config.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mycelo-cfg-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

it('defaults every field when the file is absent', () => {
  const config = loadBootstrap(join(dir, 'mycelo.yaml'))
  expect(config.prefix).toBe('/')
  expect(config.sporesDir).toBe(resolve(dir, 'fixtures'))
})

it('reads what the file declares', () => {
  const file = join(dir, 'mycelo.yaml')
  writeFileSync(file, 'prefix: "!"\nspores: ./plugins\n', 'utf8')
  const config = loadBootstrap(file)
  expect(config.prefix).toBe('!')
  expect(config.sporesDir).toBe(resolve(dir, 'plugins'))
})

it('ignores fields later phases will add', () => {
  const file = join(dir, 'mycelo.yaml')
  writeFileSync(file, 'prefix: "/"\ndatabase: /data/mycelo.db\nui:\n  port: 8730\n', 'utf8')
  expect(loadBootstrap(file).prefix).toBe('/')
})

it('names the offending path when a field has the wrong type', () => {
  const file = join(dir, 'mycelo.yaml')
  writeFileSync(file, 'prefix: 42\n', 'utf8')
  expect(() => loadBootstrap(file)).toThrow(BootstrapError)
})
