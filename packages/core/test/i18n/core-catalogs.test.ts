import { describe, expect, it } from 'bun:test'
import { loadCoreCatalogs } from '../../src/i18n/core-catalogs.js'

const catalogs = loadCoreCatalogs()

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
})
