import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, test } from 'bun:test'
import { assertNoCollisions, discover } from '../../src/germination/discover.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mycelo-disc-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

function spore(name: string): void {
  mkdirSync(join(dir, name), { recursive: true })
  writeFileSync(join(dir, name, 'spore.yaml'), 'kind: enzyme\n', 'utf8')
}

it('returns nothing when the directory does not exist', () => {
  expect(discover([join(dir, 'absent')])).toEqual([])
})

it('finds every subdirectory holding a spore.yaml, sorted', () => {
  spore('zeta')
  spore('alpha')
  expect(discover([dir]).map((l) => l.directory)).toEqual(['alpha', 'zeta'])
})

it('ignores a subdirectory with no manifest', () => {
  spore('real')
  mkdirSync(join(dir, 'not-a-spore'), { recursive: true })
  expect(discover([dir]).map((l) => l.directory)).toEqual(['real'])
})

test('discovers spores across every root, in root order', () => {
  const a = mkdtempSync(join(tmpdir(), 'mycelo-a-'))
  const b = mkdtempSync(join(tmpdir(), 'mycelo-b-'))
  mkdirSync(join(a, 'zulu')); writeFileSync(join(a, 'zulu', 'spore.yaml'), 'kind: rhiza\n')
  mkdirSync(join(b, 'alpha')); writeFileSync(join(b, 'alpha', 'spore.yaml'), 'kind: rhiza\n')

  const found = discover([a, b])

  expect(found.map((l) => l.directory)).toEqual(['zulu', 'alpha'])
})

test('a directory name in two roots is refused, naming both paths', () => {
  const a = mkdtempSync(join(tmpdir(), 'mycelo-a-'))
  const b = mkdtempSync(join(tmpdir(), 'mycelo-b-'))
  for (const root of [a, b]) {
    mkdirSync(join(root, 'ping'))
    writeFileSync(join(root, 'ping', 'spore.yaml'), 'kind: rhiza\n')
  }

  expect(() => { assertNoCollisions([a, b]) }).toThrow(new RegExp(`${a}.*${b}|${b}.*${a}`, 's'))
})
