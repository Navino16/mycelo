import { describe, expect, it } from 'bun:test'
import type { Translator } from '../../src/i18n/translator.js'
import { bindTranslate } from '../../src/i18n/bind.js'

// Echoes what it was asked, so a test can assert the routing rather than the rendering.
const spy = (): Translator & { calls: string[] } => {
  const calls: string[] = []
  return {
    calls,
    translate: (domain, key, locale, params) => {
      calls.push(`${domain}|${key}|${locale}|${JSON.stringify(params ?? {})}`)
      return `${domain}:${key}`
    },
    availableLocales: () => ['en', 'fr'],
  }
}

describe('bindTranslate', () => {
  it('reads a bare key in the spore\'s own domain', () => {
    const translator = spy()
    const t = bindTranslate({ translator, domain: 'media', allowed: new Set(), localeOf: () => 'fr' })
    expect(t('found')).toBe('media:found')
    expect(translator.calls[0]).toBe('media|found|fr|{}')
  })

  it('uses the locale the thunk answers now, not the one it answered when bound', () => {
    const translator = spy()
    let locale = 'en'
    const t = bindTranslate({ translator, domain: 'media', allowed: new Set(), localeOf: () => locale })
    t('found')
    locale = 'ru'
    t('found')
    expect(translator.calls).toEqual(['media|found|en|{}', 'media|found|ru|{}'])
  })

  it('lets an explicit locale override the thunk', () => {
    const translator = spy()
    const t = bindTranslate({ translator, domain: 'media', allowed: new Set(), localeOf: () => 'fr' })
    t('found', {}, 'ru')
    expect(translator.calls[0]).toBe('media|found|ru|{}')
  })

  it('reads the domain of every declared rhiza, not merely the first', () => {
    const translator = spy()
    const t = bindTranslate({
      translator, domain: 'media', allowed: new Set(['mock', 'radarr']), localeOf: () => 'en',
    })
    // Both, not one: an `allowed` set collapsed to its last element is the cardinality
    // mutation phase 5.5's campaign kept surviving.
    expect(t({ domain: 'mock', key: 'a' })).toBe('mock:a')
    expect(t({ domain: 'radarr', key: 'b' })).toBe('radarr:b')
  })

  it("reads 'common' without it being declared anywhere", () => {
    const translator = spy()
    const t = bindTranslate({ translator, domain: 'media', allowed: new Set(), localeOf: () => 'en' })
    expect(t({ domain: 'common', key: 'yes' })).toBe('common:yes')
  })

  it('throws for a domain the manifest does not require, naming it', () => {
    const translator = spy()
    const t = bindTranslate({ translator, domain: 'media', allowed: new Set(['mock']), localeOf: () => 'en' })
    expect(() => t({ domain: 'radarr', key: 'a' })).toThrow("translation domain 'radarr' is not declared")
  })

  it("throws for the core's own domain, which is closed to plugins", () => {
    const translator = spy()
    const t = bindTranslate({ translator, domain: 'media', allowed: new Set(['core']), localeOf: () => 'en' })
    // Even with 'core' somehow in the allowed set: the runtime's messages change without
    // notice for plugin authors (design §3.1).
    expect(() => t({ domain: 'core', key: 'command.denied' })).toThrow("translation domain 'core' is not declared")
  })

  it("merges a ref's own params with the call's, the call winning", () => {
    const translator = spy()
    const t = bindTranslate({ translator, domain: 'media', allowed: new Set(['mock']), localeOf: () => 'en' })
    t({ domain: 'mock', key: 'a', params: { title: 'Dune', year: 2021 } }, { title: 'Arrakis' })
    expect(translator.calls[0]).toBe('mock|a|en|{"title":"Arrakis","year":2021}')
  })
})
