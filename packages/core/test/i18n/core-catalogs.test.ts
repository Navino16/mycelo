import { describe, expect, it } from 'bun:test'
import { CONVERSATION_KINDS } from '@mycelo/septum'
import { assertCoreCatalogs, loadCoreCatalogs } from '../../src/i18n/core-catalogs.js'
import { StartupError } from '../../src/identity/bootstrap.js'
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

// boot/start.ts's onOutOfContext computes `context.${where}` from a ConversationKind with no
// static check that the key exists. Pinned bidirectionally, as this project already pins
// MYCELIUM_SCOPES against MOUNTABLE_SCOPES: a third ConversationKind with no matching key
// would render raw, and a stale `context.*` key with no ConversationKind is dead weight.
describe("CONVERSATION_KINDS against the core catalogue's context.* keys", () => {
  it('carries a context.<kind> key, in every locale, for every ConversationKind', () => {
    const core = catalogs.get('core')
    for (const locale of core?.keys() ?? []) {
      for (const kind of CONVERSATION_KINDS) {
        expect(core?.get(locale)?.has(`context.${kind}`)).toBe(true)
      }
    }
  })

  it('declares no context.* key that names a kind CONVERSATION_KINDS does not have', () => {
    const core = catalogs.get('core')
    const known = new Set<string>(CONVERSATION_KINDS)
    for (const messages of core?.values() ?? []) {
      const contextKinds = [...messages.keys()]
        .filter((key) => key.startsWith('context.'))
        .map((key) => key.slice('context.'.length))
      expect(contextKinds.filter((kind) => !known.has(kind))).toEqual([])
    }
  })
})

// Finding 3 of the phase 5.6 whole-branch review: nothing asserted these catalogues exist
// at boot, so a deployment missing packages/core/translations/ started clean and answered
// every refusal with a raw catalogue key.
describe('assertCoreCatalogs', () => {
  it("does not throw for the real catalogues and the locale they actually ship, 'en'", () => {
    expect(() => { assertCoreCatalogs(catalogs, 'en') }).not.toThrow()
  })

  it('refuses a default locale neither real catalogue ships, naming what it does provide', () => {
    expect(() => { assertCoreCatalogs(catalogs, 'ru') }).toThrow(StartupError)
    expect(() => { assertCoreCatalogs(catalogs, 'ru') }).toThrow("'core' translation catalogue")
    // Same register as requireAvailable's refusal, not a container path an operator
    // running an image cannot act on.
    expect(() => { assertCoreCatalogs(catalogs, 'ru') }).toThrow('available: en, fr')
  })

  it('refuses when the core domain is missing entirely', () => {
    const missingCore: Catalogs = new Map([['common', catalogs.get('common') ?? new Map()]])
    expect(() => { assertCoreCatalogs(missingCore, 'en') }).toThrow("'core' translation catalogue")
  })

  it('refuses when the common domain is missing entirely, not just the core one', () => {
    // Both, not one: a guard written against a single literal is the cardinality mutation
    // phase 5.5's campaign kept surviving.
    const missingCommon: Catalogs = new Map([['core', catalogs.get('core') ?? new Map()]])
    expect(() => { assertCoreCatalogs(missingCommon, 'en') }).toThrow("'common' translation catalogue")
  })

  it('refuses an entirely empty set of catalogues, as a deployment with no translations/ at all would produce', () => {
    expect(() => { assertCoreCatalogs(new Map(), 'en') }).toThrow(StartupError)
  })
})
