import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { rangeRejection } from '../src/compat.js'
import { parseManifest } from '../src/manifest.js'

/**
 * README.md and CHANGELOG.md both ship in the tarball and cannot be recalled. Re-reading them has
 * failed to catch a stale refusal string five times, so this checks them by running the package
 * instead: every quoted refusal a doc prints must be one the package can actually emit.
 */
const DOCS = ['README.md', 'CHANGELOG.md'] as const
const read = (name: string): string => readFileSync(join(import.meta.dir, '..', name), 'utf8')

/** Every refusal the package can produce for a `septum:` range, as literal text. */
function producibleMessages(): ReadonlySet<string> {
  const out = new Set<string>()
  const corpus = [
    'latest', '*', 'x', 'X', '', '   ', '>=x', '<=x', '=x', '^x', '~*', 'x.x', 'x.x.x', 'vx', '||',
    'x || x', '*||*', '* || ^0.10', '^0.10 || *', '1.2.3.4', '1.2.-3', '0..10', '^0.10.', 'a.b.c',
    '<', '>=', '^', '~', '>=0.0.1', '<99999.0.1', '0.0.0 - 99999.0.0', '0.0.1 || 99999.0.0',
    '<0.5 || >=2', '^0.9', '^1.0', '^0.10', '>=0.10.0', '0.10.x', '>=0.9 <0.12', 'not a range',
  ]
  for (const septum of corpus) {
    try {
      parseManifest({ kind: 'rhiza', name: 'probe', septum })
    } catch (e) {
      out.add((e as Error).message)
    }
    const rejection = rangeRejection(septum)
    if (rejection !== undefined) out.add(rejection)
  }
  return out
}

/**
 * A backticked span that quotes a range and then says something about it — the shape of every
 * refusal these files have ever printed, and of every stale one they have carried.
 */
function quotedRefusals(markdown: string): { span: string, line: number }[] {
  const found: { span: string, line: number }[] = []
  // Scanned over the whole text, not line by line: a refusal long enough to be worth quoting is
  // long enough to be wrapped, and a per-line scan silently finds nothing at all.
  for (const match of markdown.matchAll(/`('[^'`]*'[\s\S]{1,200}?)`/g)) {
    const raw = match[1] as string
    if (!/^'[^']*'\s+[a-z]/.test(raw.replace(/\s+/g, ' '))) continue
    found.push({ span: raw.replace(/\s+/g, ' ').trim(), line: markdown.slice(0, match.index).split('\n').length })
  }
  return found
}

describe('every refusal quoted in a shipped doc is one the package can emit', () => {
  const messages = producibleMessages()

  it('produces a non-trivial set of refusals to check against', () => {
    // Guards the guard: an empty set would make every assertion below vacuous.
    expect(messages.size).toBeGreaterThan(2)
  })

  it('actually finds refusals in the docs to check', () => {
    // The other half of guarding the guard, and it has already failed once: a per-line scan
    // matched nothing because the one quoted refusal wraps, so the check passed on zero input.
    const scanned = DOCS.flatMap((doc) => quotedRefusals(read(doc)))
    expect(scanned.length).toBeGreaterThan(0)
  })

  for (const doc of DOCS) {
    it(`${doc} quotes no refusal the package cannot produce`, () => {
      const stale = quotedRefusals(read(doc)).filter(({ span }) => {
        // A doc may elide a message's tail with an ellipsis; the head must still be real.
        const head = span.replace(/\s*(…|\.\.\.)\s*$/, '').trimEnd()
        return ![...messages].some((m) => m === head || m.startsWith(head))
      })
      expect(stale.map(({ span, line }) => `${doc}:${String(line)} ${span}`)).toEqual([])
    })
  }
})

/**
 * The two documented rejection buckets, checked against the matcher rather than against a reader.
 * The lists are read out of the prose, so renaming a range in a doc without moving it is caught.
 */
describe('the rejection buckets the docs enumerate match what the matcher does', () => {
  const CANNOT = 'is not a range this matcher can parse'
  const PROBE = 'admits both 0.0.1 and 99999.0.0'

  /** Backticked tokens inside one parenthetical, e.g. "(`latest`, `1.2.3.4`, a bare `||`)". */
  function tokensIn(markdown: string, after: RegExp): string[] {
    const at = markdown.search(after)
    expect(at).toBeGreaterThan(-1)
    const open = markdown.indexOf('(', at)
    const close = markdown.indexOf(')', open)
    expect(open).toBeGreaterThan(-1)
    expect(close).toBeGreaterThan(open)
    return [...markdown.slice(open, close).matchAll(/`([^`]+)`/g)].map((m) => m[1] as string)
  }

  for (const doc of DOCS) {
    it(`${doc}'s cannot-parse list is exactly what the matcher cannot parse`, () => {
      const tokens = tokensIn(read(doc), /matcher\s+cannot\s+parse\s+it|one\s+the\s+matcher\s+cannot\s+parse/)
      expect(tokens.length).toBeGreaterThan(3)
      expect(tokens.filter((t) => rangeRejection(t) !== CANNOT)).toEqual([])
    })

    it(`${doc}'s probe list is exactly what parses and admits both endpoints`, () => {
      const tokens = tokensIn(read(doc), /admits both `0\.0\.1`\s+and\s+`99999\.0\.0`/)
      expect(tokens.length).toBeGreaterThan(2)
      expect(tokens.filter((t) => rangeRejection(t) !== PROBE)).toEqual([])
    })
  }
})
