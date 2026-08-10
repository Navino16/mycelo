import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { discover } from '../../src/germination/discover.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mycelo-disc-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

function spore(name: string): void {
  mkdirSync(join(dir, name), { recursive: true })
  writeFileSync(join(dir, name, 'spore.yaml'), 'kind: enzyme\n', 'utf8')
}

it('returns nothing when the directory does not exist', () => {
  expect(discover(join(dir, 'absent'))).toEqual([])
})

it('finds every subdirectory holding a spore.yaml, sorted', () => {
  spore('zeta')
  spore('alpha')
  expect(discover(dir).map((l) => l.directory)).toEqual(['alpha', 'zeta'])
})

it('ignores a subdirectory with no manifest', () => {
  spore('real')
  mkdirSync(join(dir, 'not-a-spore'), { recursive: true })
  expect(discover(dir).map((l) => l.directory)).toEqual(['real'])
})
