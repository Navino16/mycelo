import { describe, expect, it } from 'bun:test'
import { loadCoreCatalogs } from '../../src/i18n/core-catalogs.js'
import type { Catalogs } from '../../src/i18n/catalog.js'

const catalogs = loadCoreCatalogs()

// A message's compiled AST carries one element per literal run or argument; every
// non-literal element (argument, number, date, time, select, plural) names its parameter
// in `value`, and select/plural nest further elements per branch in `options`. Duck-typed
// against `unknown` rather than importing @formatjs/icu-messageformat-parser's types,
// which intl-messageformat does not re-export and this workspace does not depend on.
interface FormatElementLike {
  type: number
  value?: unknown
  options?: Record<string, { value?: unknown }>
}

function isElementLike(x: unknown): x is FormatElementLike {
  return typeof x === 'object' && x !== null && 'type' in x && typeof x.type === 'number'
}

function collectArgumentNames(elements: unknown, into: Set<string>): void {
  if (!Array.isArray(elements)) return
  for (const raw of elements) {
    if (!isElementLike(raw)) continue
    // type 0 is a literal run, with no parameter; every other type's `value` is the name.
    if (raw.type !== 0 && typeof raw.value === 'string') into.add(raw.value)
    if (raw.options !== undefined) {
      for (const option of Object.values(raw.options)) collectArgumentNames(option.value, into)
    }
  }
}

/** Every distinct parameter name any message in `source` declares, walking every key. */
function everyParameterName(source: Catalogs): Set<string> {
  const names = new Set<string>()
  for (const byLocale of source.values()) {
    for (const messages of byLocale.values()) {
      for (const message of messages.values()) collectArgumentNames(message.getAst(), names)
    }
  }
  return names
}

describe('the core-owned catalogues', () => {
  it('publishes exactly the domains core and common', () => {
    expect([...catalogs.keys()].sort()).toEqual(['common', 'core'])
  })

  // design §11: `en` is the bottom of every cascade, so a key present only in `fr` renders
  // raw for every other locale, and one present only in `en` silently un-translates the
  // language the project claims to support. Neither is visible without this test.
  for (const domain of ['core', 'common']) {
    it(`carries the same key set in en and fr for the '${domain}' domain`, () => {
      const byLocale = catalogs.get(domain)
      const en = [...(byLocale?.get('en')?.keys() ?? [])].sort()
      const fr = [...(byLocale?.get('fr')?.keys() ?? [])].sort()
      expect(en.length).toBeGreaterThan(0)
      // Asserted in both directions on purpose: toEqual on sorted arrays would catch it,
      // but the diff a reader gets from these two names the missing side.
      expect(fr.filter((k) => !en.includes(k))).toEqual([])
      expect(en.filter((k) => !fr.includes(k))).toEqual([])
    })
  }

  it('ships en and fr and nothing else', () => {
    for (const byLocale of catalogs.values()) {
      expect([...byLocale.keys()].sort()).toEqual(['en', 'fr'])
    }
  })

  it("keeps 'yes' and 'no' as strings, whatever the YAML parser's schema", () => {
    expect(catalogs.get('common')?.get('en')?.get('yes')?.format()).toBe('yes')
    expect(catalogs.get('common')?.get('fr')?.get('no')?.format()).toBe('non')
  })

  // A single-quoted placeholder (`'{command}'`) compiles and formats without error — ICU
  // treats it as an escaped literal, so the quotes vanish and the value never substitutes.
  // That failure is silent everywhere else: the two tests above only compare key sets, and
  // most keys are otherwise exercised only incidentally, through whichever caller happens to
  // pass real params. Rendering every key, in every locale, with every parameter name the
  // catalogues use, is what actually proves substitution — not merely presence.
  it('renders every key of every core-owned domain, in every locale, with no unsubstituted placeholder', () => {
    const names = everyParameterName(catalogs)
    // A regression here means the walk above stopped finding any argument at all — silently
    // turning the test that follows into a no-op that formats with an empty bag.
    expect(names.size).toBeGreaterThan(0)
    // One shared bag for every message: an unused name is ignored by IntlMessageFormat, so
    // covering the union of every catalogue's parameters is enough. A message needing a name
    // outside this union throws MissingValueError instead of rendering wrong silently, which
    // fails this test just as loudly as an unsubstituted placeholder would.
    const params = Object.fromEntries([...names].map((name) => [name, `<${name}>`]))

    const broken: string[] = []
    for (const [domain, byLocale] of catalogs) {
      for (const [locale, messages] of byLocale) {
        for (const [key, message] of messages) {
          const rendered = String(message.format(params))
          if (rendered.includes('{') || rendered.includes('}')) {
            broken.push(`${domain}/${locale}/${key}: ${rendered}`)
          }
        }
      }
    }
    expect(broken).toEqual([])
  })
})
