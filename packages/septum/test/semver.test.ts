import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { isParseableRange, septumIncompatibility } from '../src/compat.js'
import { satisfies } from '../src/semver.js'

// Every range form the README documents, every range this project's manifests declare, the
// operator-prefix oddities, prereleases and build metadata. Bun.semver is the oracle and it
// exists only under Bun, which is exactly why septum cannot call it (see semver.ts).
const WELL_FORMED = [
  '^0.10', '>=0.10.0', '0.10.x', '>=0.9 <0.12', '^^0.10', '^^^0.10', '~~1.2', '^~1.2', '~^1.2',
  '0.10', '0', '1.2.3', '=1.2.3', '^1.0', '^1.0.0', '^0.0.3', '^0.2', '~1.2', '~1.2.3', '~0',
  '>1.2.3', '<2.0.0', '>=1.2.3 <2.0.0', '1.2.3 - 2.3.4', '1.2 - 2.3', '^1 || ^2', '1.2.3||2.0.0',
  '>=0.9', '<0.12', '1.x.x', 'v1.2.3', '  ^0.10  ', '^0.10.2-beta', '>=1.0.0-alpha',
  '^0.10.0+build', '0.10.2', '>= 0.10.0', '^0.1', '^0.9', '~0.10', '>0.10.0 <0.10.5',
  '^0.8', '^0.5', '^0.7', '^0.6', '^0.4', '^0.3', '>=0.9,<0.12', '0.x', '1.2.x', '^0.0.1',
  '~0.0.3', '^2', '>=1 <3', '1.0.0 - 1.5.0', '0.10.1 || 0.10.2', '^ 0.10', '> 1.2.3',
  '<= 2.0.0', '0.10.2 - 0.10.5', '^0.10 ^0.11', '<0.10.0 >0.11.0', '1.2.3 - x', 'x - 1.2.3',
  '0.10.X', '^0.10.x', '^v0.10', '^0.10.2+build', '^0.11', '^0.12', '~0.9', '>=0.10 <0.11',
  // An empty alternative in a `||` list contributes nothing rather than widening to everything,
  // which is the difference between `^0.10 ||` meaning `^0.10` and meaning `*`.
  '^0.10 ||', '|| ^0.10', '^0.10||', '^0.10 || ', '^0.10 || ^0.11',
]

const VERSIONS = [
  '0.0.1', '0.0.3', '0.0.4', '0.1.0', '0.1.9', '0.2.0', '0.9.0', '0.10.0', '0.10.1', '0.10.2',
  '0.10.5', '0.11.0', '0.12.0', '1.0.0', '1.2.3', '1.2.4', '1.2.9', '1.3.0', '1.5.0', '1.9.0',
  '2.0.0', '2.3.4', '3.0.0', '99999.0.0', '0.10.2-beta', '0.10.2-alpha.1', '1.0.0-alpha',
  '1.0.0-alpha.1', '1.0.0-beta', '1.2.3+build', '0.10.2+meta', 'v1.2.3', '',
]

describe('satisfies agrees with Bun.semver on every well-formed pair', () => {
  it('matches the oracle across the whole corpus', () => {
    const disagreements: string[] = []
    for (const range of WELL_FORMED) {
      for (const version of VERSIONS) {
        if (satisfies(version, range) !== Bun.semver.satisfies(version, range)) {
          disagreements.push(`${JSON.stringify(version)} vs ${JSON.stringify(range)}`)
        }
      }
    }
    expect(disagreements).toEqual([])
    // The corpus must stay large enough to be worth running: a truncated one would pass too.
    expect(WELL_FORMED.length * VERSIONS.length).toBeGreaterThan(2000)
  })

  it('covers the three verdicts this contract actually turns on', () => {
    expect(satisfies('0.10.2', '^0.10')).toBe(true)
    expect(satisfies('0.11.0', '^0.10')).toBe(false)
    expect(satisfies('0.9.0', '^0.10')).toBe(false)
  })

  it('reproduces the doubled-caret oddity rather than refusing it', () => {
    // design §10.1 records ^^0.10 as behaving identically to ^0.10; a manifest may carry it.
    for (const version of VERSIONS) {
      expect(satisfies(version, '^^0.10')).toBe(satisfies(version, '^0.10'))
    }
  })

  it('excludes a prerelease from a range that names none, and admits one that does', () => {
    expect(satisfies('0.10.2-beta', '^0.10')).toBe(false)
    expect(satisfies('0.10.2-beta', '>=0.10.0')).toBe(false)
    expect(satisfies('0.10.2-beta', '^0.10.2-alpha')).toBe(true)
    expect(satisfies('1.0.0', '^1.0.0-alpha')).toBe(true)
  })

  it('ignores build metadata on both sides', () => {
    expect(satisfies('1.2.3+build', '1.2.3')).toBe(true)
    expect(satisfies('1.2.3', '1.2.3+build')).toBe(true)
  })
})

describe('isParseableRange reaches the verdict the Bun-based definition reached', () => {
  // The definition that shipped through 0.10.1, evaluated with Bun's own matcher. What must be
  // preserved is this verdict, not satisfies() agreeing on input neither side can parse.
  const asBunWould = (range: string): boolean =>
    !(Bun.semver.satisfies('0.0.1', range) && Bun.semver.satisfies('99999.0.0', range))

  it('agrees on every well-formed range', () => {
    const disagreements = WELL_FORMED.filter((r) => isParseableRange(r) !== asBunWould(r))
    expect(disagreements).toEqual([])
  })

  it('refuses every wildcard form, as the README promises', () => {
    for (const range of ['*', 'latest', 'x', 'X', '', '   ']) {
      expect(isParseableRange(range)).toBe(false)
      expect(asBunWould(range)).toBe(false)
    }
  })

  it('refuses a malformed range, where Bun would interpret some of them', () => {
    // The divergence is fail-closed and deliberate: Bun reads `1.2.3.4` and `^0.10.` as
    // something, and a typo in a manifest is refused here rather than silently interpreted.
    for (const range of ['not a range', '1.2.3.4', '1.2.-3', '0..10', '^0.10.', '<', '>=', '^', '~', 'a.b.c', '||']) {
      expect(isParseableRange(range)).toBe(false)
    }
  })

  it('refuses a comma typo through the other sentence, never by admitting it', () => {
    // `^0,10` parses as `^0` and `10` — an empty intersection — so it is refused for excluding
    // the running septum rather than for being unparseable. Both refuse; the sentences differ.
    expect(isParseableRange('^0,10')).toBe(true)
    expect(septumIncompatibility('^0,10', '0.10.2')).toContain('excludes')
  })

  it('accepts the four forms the README documents and rejects the two it does not', () => {
    for (const range of ['^0.10', '>=0.10.0', '0.10.x', '>=0.9 <0.12']) {
      expect(isParseableRange(range)).toBe(true)
    }
    for (const range of ['*', 'latest', 'x']) {
      expect(isParseableRange(range)).toBe(false)
    }
  })
})

describe('septum runs on Node as well as Bun', () => {
  // packages/septum ships dist/ to Node and src/ to Bun (package.json exports). A `Bun.`
  // reference in src/ therefore throws ReferenceError for every Node consumer, and no test
  // running under Bun can see it.
  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return sources(path)
      return entry.name.endsWith('.ts') ? [path] : []
    })
  }

  it('references no Bun global anywhere in src/', () => {
    const files = sources(join(import.meta.dir, '..', 'src'))
    expect(files.length).toBeGreaterThan(10)
    // Comments are stripped first: semver.ts names Bun.semver in prose to say why it cannot
    // call it, and that sentence must not be what the probe trips on.
    const code = (f: string): string =>
      readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    const offenders = files.filter((f) => /(^|[^\w.$])Bun\s*\./.test(code(f)))
    expect(offenders).toEqual([])
  })

  it('exports septumIncompatibility and nothing else from compat', async () => {
    // The narrowing is the one thing the tag freezes permanently: reverting index.ts to
    // `export * from './compat.js'` would otherwise be silent.
    const surface = await import('../src/index.js')
    expect(Object.keys(surface)).toContain('septumIncompatibility')
    expect(Object.keys(surface)).not.toContain('isParseableRange')
    expect(Object.keys(surface)).not.toContain('satisfies')
    expect(Object.keys(surface)).not.toContain('parseRange')
    expect(Object.keys(surface)).not.toContain('parseVersion')
    expect(Object.keys(surface)).not.toContain('compareVersions')
  })

  it('reaches the same three verdicts through septumIncompatibility', () => {
    expect(septumIncompatibility('^0.10', '0.10.2')).toBeUndefined()
    expect(septumIncompatibility('^0.10', '0.11.0')).toContain('excludes')
    expect(septumIncompatibility('latest', '0.10.2')).toContain('not a semver range')
  })
})
