import { describe, expect, it } from 'bun:test'
import type { TranslatableRef } from '@mycelo/septum'
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

  it('renders a nested ref before ICU sees it, in a declared domain', () => {
    const translator = spy()
    const t = bindTranslate({
      translator, domain: 'media', allowed: new Set(['mock']), localeOf: () => 'en',
    })
    t({ domain: 'common', key: 'a', params: { cause: { domain: 'mock', key: 'why' } } })
    // The rendered sentence, not the object: without resolution ICU is handed a non-primitive
    // and the parameter reaches the reader as '[object Object]'.
    expect(translator.calls[1]).toBe('common|a|en|{"cause":"mock:why"}')
  })

  it('joins an array parameter, refs and primitives alike', () => {
    const translator = spy()
    const t = bindTranslate({ translator, domain: 'media', allowed: new Set(), localeOf: () => 'en' })
    t('listed', { issues: [{ domain: 'common', key: 'one' }, { domain: 'common', key: 'two' }], plain: ['a', 'b'] })
    // Joined here, never in ICU: IntlMessageFormat.format returns an array for a non-primitive
    // parameter, and stringifying that prepends a comma.
    expect(translator.calls[2]).toBe('media|listed|en|{"issues":"common:one, common:two","plain":"a, b"}')
  })

  it('renders a nested ref of an undeclared domain as its bare key, without throwing', () => {
    const translator = spy()
    const t = bindTranslate({ translator, domain: 'media', allowed: new Set(['mock']), localeOf: () => 'en' })
    // §5.3: `allowed` is the authority for a nested ref too, or a crafted ref would let one
    // spore read another's catalogue through a path nothing audits. Both the undeclared domain
    // and `core` — a gate testing only one of the two is half a gate.
    t({ domain: 'common', key: 'a', params: { third: { domain: 'radarr', key: 'secret' } } })
    expect(translator.calls[0]).toBe('common|a|en|{"third":"secret"}')
    const closed = bindTranslate({
      translator, domain: 'media', allowed: new Set(['core']), localeOf: () => 'en',
    })
    closed({ domain: 'common', key: 'a', params: { third: { domain: 'core', key: 'api.internalError' } } })
    expect(translator.calls[1]).toBe('common|a|en|{"third":"api.internalError"}')
  })

  it('caps the depth of a self-referential ref rather than overflowing', () => {
    const translator = spy()
    const t = bindTranslate({ translator, domain: 'media', allowed: new Set(), localeOf: () => 'en' })
    const ref: TranslatableRef = { domain: 'media', key: 'loop' }
    ref.params = { cause: ref }
    // A plugin can hand ctx.t a cycle; the cap must render rather than kill the bus.
    expect(t(ref)).toBe('media:loop')
    expect(translator.calls.length).toBe(9)
  })

  it("merges a ref's own params with the call's, the call winning", () => {
    const translator = spy()
    const t = bindTranslate({ translator, domain: 'media', allowed: new Set(['mock']), localeOf: () => 'en' })
    t({ domain: 'mock', key: 'a', params: { title: 'Dune', year: 2021 } }, { title: 'Arrakis' })
    expect(translator.calls[0]).toBe('mock|a|en|{"title":"Arrakis","year":2021}')
  })
})
