import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'

/**
 * The class names only tone.ts may spell. A component keeping its own copy of one is how
 * `dormant` came to be crit in StateBadge alone while every other surface called it amber —
 * and an assertion comparing a rendered class against the table's own value cannot see it.
 */
const TONE_LITERAL = /\btext-(?:ok|warn|crit|idle)\b|\bbg-(?:ok|warn|crit|idle)(?:-bg)?\b|\bborder-(?:ok|warn|crit)\b/

/** Where the table itself lives, relative to the two directories scanned. */
const TABLE = 'components/tone.ts'

/**
 * Files that spell a tone themselves, with the reason each is not yet routed through the
 * table. Each is due for rework by a later task, which is when its entry goes.
 */
const ALLOWED: Readonly<Record<string, string>> = {
  // The dormant diagnosis panel predates the tone table; its screen is task 17's.
  'components/DormantDiagnosis.tsx': 'task 17 owns the dormant diagnosis surface',
}

const SRC = new URL('../../src/', import.meta.url).pathname

function sourcesIn(dir: string): readonly string[] {
  return readdirSync(SRC + dir)
    .filter((name) => name.endsWith('.ts') || name.endsWith('.tsx'))
    .map((name) => `${dir}/${name}`)
}

describe('the tone table is the only place a tone colour is spelled', () => {
  it('finds the two directories it means to scan', () => {
    const files = [...sourcesIn('components'), ...sourcesIn('shell')]

    expect(files).toContain(TABLE)
    expect(files).toContain('shell/HealthPill.tsx')
    expect(files.length).toBeGreaterThan(15)
  })

  it('spells every tone literal in tone.ts and nowhere else', () => {
    const offenders = [...sourcesIn('components'), ...sourcesIn('shell')]
      .filter((file) => file !== TABLE && !(file in ALLOWED))
      .filter((file) => TONE_LITERAL.test(readFileSync(SRC + file, 'utf8')))

    expect(offenders).toEqual([])
  })

  // Guards the allowlist itself: an entry left behind after its file is reworked would
  // silently re-open the hole it was written to document.
  it('keeps no allowlist entry for a file that no longer needs one', () => {
    const stale = Object.keys(ALLOWED).filter(
      (file) => !TONE_LITERAL.test(readFileSync(SRC + file, 'utf8')),
    )

    expect(stale).toEqual([])
  })

  it('reads the table itself as carrying all four tones', () => {
    const table = readFileSync(SRC + TABLE, 'utf8')

    for (const tone of ['ok', 'warn', 'crit', 'idle']) {
      expect(table).toContain(`text-${tone}`)
      expect(table).toContain(`bg-${tone}`)
    }
  })
})
