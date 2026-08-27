/**
 * A pure-JS subset of semver range matching, agreeing with `Bun.semver.satisfies` on the corpus
 * in `test/semver.test.ts`. Hand-rolled rather than depended on or delegated: septum must run on
 * Node as well as Bun (`exports` serves `dist/` to one and `src/` to the other), and its only
 * dependencies are zod and intl-messageformat.
 */

interface Version {
  major: number
  minor: number
  patch: number
  /** Dot-separated prerelease identifiers, numeric where they are all digits. */
  pre: readonly (string | number)[]
}

interface Comparator {
  op: '<' | '<=' | '>' | '>=' | '='
  version: Version
}

/** A range is a union of comparator sets; `null` inside a set means "match every version". */
type ComparatorSet = readonly Comparator[] | null

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/
const WILDCARD = /^[xX*]$/

function identifiers(pre: string | undefined): readonly (string | number)[] {
  if (pre === undefined || pre === '') return []
  return pre.split('.').map((id) => (/^\d+$/.test(id) ? Number(id) : id))
}

/** Strips build metadata, which semver excludes from precedence entirely. */
export function parseVersion(input: string): Version | null {
  const withoutBuild = input.trim().replace(/\+.*$/, '').replace(/^[v=]+/, '')
  // Bun reads an empty version as 0.0.0 rather than as a failure. Measured on 1.4.0, and
  // reproduced so the two never disagree; no caller of this module passes one.
  if (withoutBuild === '') return { major: 0, minor: 0, patch: 0, pre: [] }
  const m = VERSION.exec(withoutBuild)
  if (m === null) return null
  return {
    major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: identifiers(m[4]),
  }
}

function comparePre(a: readonly (string | number)[], b: readonly (string | number)[]): number {
  // A version with a prerelease has lower precedence than one without (semver §11.3).
  if (a.length === 0 && b.length === 0) return 0
  if (a.length === 0) return 1
  if (b.length === 0) return -1
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i]
    const y = b[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x === y) continue
    if (typeof x === 'number' && typeof y === 'number') return x < y ? -1 : 1
    if (typeof x === 'number') return -1
    if (typeof y === 'number') return 1
    return x < y ? -1 : 1
  }
  return 0
}

export function compareVersions(a: Version, b: Version): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1
  return comparePre(a.pre, b.pre)
}

interface Partial {
  major: number
  minor: number | null
  patch: number | null
  pre: readonly (string | number)[]
}

/** A version with `x`/`*` or missing components, as a range token writes it. */
function parsePartial(input: string): Partial | null {
  const withoutBuild = input.replace(/\+.*$/, '').replace(/^[v=]+/, '')
  if (withoutBuild === '' || WILDCARD.test(withoutBuild)) return null
  const dash = withoutBuild.indexOf('-')
  const core = dash === -1 ? withoutBuild : withoutBuild.slice(0, dash)
  const pre = dash === -1 ? [] : identifiers(withoutBuild.slice(dash + 1))
  const parts = core.split('.')
  if (parts.length > 3) return null
  const numbers: (number | null)[] = []
  for (const part of parts) {
    if (WILDCARD.test(part)) {
      numbers.push(null)
      continue
    }
    if (!/^\d+$/.test(part)) return null
    numbers.push(Number(part))
  }
  const major = numbers[0]
  if (major === undefined || major === null) return null
  return { major, minor: numbers[1] ?? null, patch: numbers[2] ?? null, pre }
}

function version(major: number, minor: number, patch: number, pre: readonly (string | number)[] = []): Version {
  return { major, minor, patch, pre }
}

function atLeast(p: Partial): Comparator {
  return { op: '>=', version: version(p.major, p.minor ?? 0, p.patch ?? 0, p.pre) }
}

/** `>=1.2.0 <1.3.0` for `1.2`, `>=1.0.0 <2.0.0` for `1` — what a partial version means alone. */
function partialRange(p: Partial): readonly Comparator[] {
  if (p.minor === null) return [atLeast(p), { op: '<', version: version(p.major + 1, 0, 0) }]
  if (p.patch === null) return [atLeast(p), { op: '<', version: version(p.major, p.minor + 1, 0) }]
  return [{ op: '=', version: version(p.major, p.minor, p.patch, p.pre) }]
}

function caretRange(p: Partial): readonly Comparator[] {
  const lower = atLeast(p)
  if (p.major !== 0) return [lower, { op: '<', version: version(p.major + 1, 0, 0) }]
  if (p.minor === null) return [lower, { op: '<', version: version(1, 0, 0) }]
  if (p.minor !== 0 || p.patch === null) {
    return [lower, { op: '<', version: version(0, p.minor + 1, 0) }]
  }
  return [lower, { op: '<', version: version(0, 0, p.patch + 1) }]
}

function tildeRange(p: Partial): readonly Comparator[] {
  const lower = atLeast(p)
  if (p.minor === null) return [lower, { op: '<', version: version(p.major + 1, 0, 0) }]
  return [lower, { op: '<', version: version(p.major, p.minor + 1, 0) }]
}

// Bun tolerates repeated and mixed operator prefixes: `^^0.10` behaves as `^0.10`, and both
// `^~1.2` and `~^1.2` behave as `~1.2`. Measured on Bun 1.4.0; reproduced rather than refused.
const PREFIX = /^([~^]+)\s*/

function comparatorsFor(token: string): readonly Comparator[] | null | 'invalid' {
  const prefixed = PREFIX.exec(token)
  if (prefixed !== null) {
    const partial = parsePartial(token.slice(prefixed[0].length))
    if (partial === null) return 'invalid'
    return prefixed[1]?.includes('~') === true ? tildeRange(partial) : caretRange(partial)
  }
  const operator = /^(<=|>=|<|>|=)\s*/.exec(token)
  if (operator !== null) {
    const rest = token.slice(operator[0].length)
    const partial = parsePartial(rest)
    // `>=x` and `<*` are the whole-range wildcard with an operator bolted on; treat as invalid
    // rather than guessing, since no documented range form writes one.
    if (partial === null) return 'invalid'
    const op = operator[1] as Comparator['op']
    if (partial.minor === null || partial.patch === null) {
      // A partial bound: `>=0.9` is `>=0.9.0`, `<0.12` is `<0.12.0`.
      return [{ op, version: version(partial.major, partial.minor ?? 0, partial.patch ?? 0, partial.pre) }]
    }
    return [{ op, version: version(partial.major, partial.minor, partial.patch, partial.pre) }]
  }
  if (WILDCARD.test(token)) return null
  const partial = parsePartial(token)
  if (partial === null) return 'invalid'
  return partialRange(partial)
}

function hyphenRange(left: string, right: string): readonly Comparator[] | 'invalid' {
  // A wildcard on either side is that side unbounded: `1.2.3 - x` is `>=1.2.3`.
  const from = WILDCARD.test(left) ? null : parsePartial(left)
  const to = WILDCARD.test(right) ? null : parsePartial(right)
  if ((from === null && !WILDCARD.test(left)) || (to === null && !WILDCARD.test(right))) return 'invalid'
  const comparators: Comparator[] = []
  if (from !== null) comparators.push(atLeast(from))
  if (to !== null) {
    comparators.push(to.minor === null
      ? { op: '<', version: version(to.major + 1, 0, 0) }
      : to.patch === null
        ? { op: '<', version: version(to.major, to.minor + 1, 0) }
        : { op: '<=', version: version(to.major, to.minor, to.patch, to.pre) })
  }
  return comparators
}

/** Null when the range is not one this subset understands — the caller refuses rather than guesses. */
export function parseRange(range: string): readonly ComparatorSet[] | null {
  const sets: ComparatorSet[] = []
  // A wholly empty range is the wildcard; an empty alternative inside a `||` list contributes
  // nothing, so `^0.10 ||` stays `^0.10` rather than widening to everything.
  if (range.trim() === '') return [null]
  for (const alternative of range.split('||')) {
    const trimmed = alternative.trim()
    if (trimmed === '') continue
    if (WILDCARD.test(trimmed)) {
      sets.push(null)
      continue
    }
    const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(trimmed)
    if (hyphen !== null) {
      const built = hyphenRange(hyphen[1] ?? '', hyphen[2] ?? '')
      if (built === 'invalid') return null
      sets.push(built)
      continue
    }
    const comparators: Comparator[] = []
    let wildcardOnly = true
    // `>= 0.10.0` is one comparator, not two tokens: the separator split would otherwise cut it
    // at the space and leave a bare operator behind.
    for (const token of trimmed.replace(/([<>]=?|=|[~^]+)\s+/g, '$1').split(/[\s,]+/)) {
      if (token === '') continue
      const built = comparatorsFor(token)
      if (built === 'invalid') return null
      if (built === null) continue
      wildcardOnly = false
      comparators.push(...built)
    }
    sets.push(wildcardOnly ? null : comparators)
  }
  return sets.length === 0 ? null : sets
}

function holds(v: Version, c: Comparator): boolean {
  const order = compareVersions(v, c.version)
  switch (c.op) {
    case '<': return order < 0
    case '<=': return order <= 0
    case '>': return order > 0
    case '>=': return order >= 0
    case '=': return order === 0
  }
}

function satisfiesSet(v: Version, set: ComparatorSet): boolean {
  if (set === null) return v.pre.length === 0
  if (!set.every((c) => holds(v, c))) return false
  if (v.pre.length === 0) return true
  // A prerelease only satisfies a set that mentions a prerelease on the same version (semver's
  // rule, and node-semver's): otherwise 0.10.2-beta would slip into `>=0.10.0`.
  return set.some((c) => c.version.pre.length > 0
    && c.version.major === v.major && c.version.minor === v.minor && c.version.patch === v.patch)
}

/** False for a version or a range this subset cannot parse — never a permissive fallback. */
export function satisfies(rawVersion: string, rawRange: string): boolean {
  const v = parseVersion(rawVersion)
  if (v === null) return false
  const sets = parseRange(rawRange)
  if (sets === null) return false
  return sets.some((set) => satisfiesSet(v, set))
}
