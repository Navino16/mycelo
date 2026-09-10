import { expect, test } from 'bun:test'
import { IntlMessageFormat } from 'intl-messageformat'
import type { Logger } from '@mycelo/septum'
import type { Catalogs } from '../../src/i18n/catalog.js'
import { createTranslator } from '../../src/i18n/translator.js'
import { renderConfigIssue, renderRefusal } from '../../src/i18n/refusal.js'

function build(src: Record<string, Record<string, Record<string, string>>>): Catalogs {
  const domains = new Map<string, Map<string, Map<string, IntlMessageFormat>>>()
  for (const [domain, byLocale] of Object.entries(src)) {
    const locales = new Map<string, Map<string, IntlMessageFormat>>()
    for (const [locale, msgs] of Object.entries(byLocale)) {
      const compiled = new Map<string, IntlMessageFormat>()
      for (const [k, v] of Object.entries(msgs)) compiled.set(k, new IntlMessageFormat(v, locale))
      locales.set(locale, compiled)
    }
    domains.set(domain, locales)
  }
  return domains
}

const silent: Logger = { info() {}, warn() {}, error() {}, debug() {}, child: () => silent }

const translator = createTranslator({
  defaultLocale: 'en',
  logger: silent,
  catalogs: build({
    common: {
      fr: {
        'refusal.config.tooSmall': '{origin, select, string{doit faire au moins {minimum} caractères} array{doit contenir au moins {minimum} éléments} other{doit valoir au moins {minimum}}}',
        'refusal.germination.dependencyDormant': 'requiert le rhiza {rhiza}, qui est dormant : {cause}',
        'refusal.germination.septumIncompatible': 'le spore {plugin} {detail}',
        'refusal.deep': 'niveau : {cause}',
      },
      en: { 'refusal.config.tooSmall': 'must be at least {minimum}', 'refusal.deep': 'level: {cause}' },
    },
    plex: { fr: { 'config.path.relative': 'le chemin doit être absolu' } },
    // Present with real text on purpose: a `core` catalogue that resolved nothing would make the
    // nested-domain gate below pass whether the gate exists or not.
    core: { fr: { 'api.internalError': 'erreur interne du serveur' } },
  }),
})

test('origin selects the sentence, so one key serves string, array and number', () => {
  const of = (origin: string, minimum: number): string =>
    renderRefusal(translator, { domain: 'common', key: 'refusal.config.tooSmall', params: { origin, minimum } }, 'fr')
  // All three branches, deliberately: a select whose selector is never passed renders `other`,
  // which reads like a success.
  expect(of('string', 3)).toBe('doit faire au moins 3 caractères')
  expect(of('array', 2)).toBe('doit contenir au moins 2 éléments')
  expect(of('number', 1)).toBe('doit valoir au moins 1')
})

test('a parameter that is a ref is rendered before ICU sees it', () => {
  expect(renderRefusal(translator, {
    domain: 'common',
    key: 'refusal.germination.dependencyDormant',
    params: {
      rhiza: 'radarr',
      cause: {
        domain: 'common',
        key: 'refusal.germination.septumIncompatible',
        params: { plugin: 'radarr', detail: 'needs septum ^1.0' },
      },
    },
  }, 'fr')).toBe('requiert le rhiza radarr, qui est dormant : le spore radarr needs septum ^1.0')
})

test('an array of refs renders element-wise and joins', () => {
  // Task 8's `configuration is incomplete: {issues}` needs exactly this: one refusal quoting
  // every issue, each translated.
  expect(renderRefusal(translator, {
    domain: 'common', key: 'refusal.deep',
    params: { cause: [
      { domain: 'common', key: 'refusal.config.tooSmall', params: { origin: 'number', minimum: 1 } },
      { domain: 'common', key: 'refusal.config.tooSmall', params: { origin: 'string', minimum: 3 } },
    ] },
  }, 'fr')).toBe('niveau : doit valoir au moins 1, doit faire au moins 3 caractères')
})

test('a plain object that is not a ref reaches ICU untouched', () => {
  // The guard must be a guard against something: widened to any object, this would try to
  // translate `{ notARef: 1 }` and render a raw key.
  expect(renderRefusal(translator, { domain: 'common', key: 'refusal.deep', params: { cause: { notARef: 1 } } }, 'fr'))
    .toContain('[object Object]')
})

test('a nested ref naming core renders as its bare key, never core\'s own text', () => {
  // §3.1: `core` is closed to plugins, and a plugin's issue params reach this renderer verbatim.
  // The top-level messageKey rule is pinned below; this is the nested one the resolver added.
  expect(renderRefusal(translator, {
    domain: 'common', key: 'refusal.deep',
    params: { cause: { domain: 'core', key: 'api.internalError' } },
  }, 'fr')).toBe('niveau : api.internalError')
})

test('depth is capped, and the cap renders rather than throwing', () => {
  let deep: unknown = 'bottom'
  for (let i = 0; i < 12; i++) deep = { domain: 'common', key: 'refusal.deep', params: { cause: deep } }
  const rendered = renderRefusal(translator, deep as never, 'fr')
  // Nine levels render (depth 0 through 8), then the innermost shows as its own key. A cap that
  // threw would make a request die while answering it.
  expect(rendered.split('niveau :').length - 1).toBe(9)
  expect(rendered.endsWith('refusal.deep')).toBe(true)
})

test('a bare messageKey resolves in the producing spore\'s own domain', () => {
  expect(renderConfigIssue(translator, { path: ['p'], message: 'EN', messageKey: 'config.path.relative' }, 'plex', 'fr'))
    .toBe('le chemin doit être absolu')
})

test('a common ref is honoured, and the issue params win over the ref params', () => {
  expect(renderConfigIssue(translator, {
    path: ['p'], message: 'EN',
    messageKey: { domain: 'common', key: 'refusal.config.tooSmall', params: { origin: 'array', minimum: 9 } },
    params: { origin: 'string', minimum: 3 },
  }, 'plex', 'fr')).toBe('doit faire au moins 3 caractères')
})

test('any other domain falls back to message, core and a declared rhiza alike', () => {
  // §5.3: honouring an arbitrary domain here would hand a plugin a read channel bindTranslate
  // refuses it elsewhere, through a path nothing audits.
  for (const domain of ['core', 'radarr']) {
    expect(renderConfigIssue(translator, {
      path: ['p'], message: 'falls back', messageKey: { domain, key: 'anything' },
    }, 'plex', 'fr')).toBe('falls back')
  }
})

test('no messageKey renders message, which is the pre-0.12 behaviour', () => {
  expect(renderConfigIssue(translator, { path: ['p'], message: 'Too small: expected' }, 'plex', 'fr'))
    .toBe('Too small: expected')
})

test('renderRefusal does not throw on a ref carrying params: null', () => {
  // params is untyped across the plugin boundary; a plugin's own ref may set it to null.
  expect(renderRefusal(translator, {
    domain: 'plex', key: 'config.path.relative', params: null as unknown as Record<string, unknown>,
  }, 'fr')).toBe('le chemin doit être absolu')
})

test('renderConfigIssue does not throw on a string-key issue carrying params: null', () => {
  expect(renderConfigIssue(translator, {
    path: ['p'], message: 'EN', messageKey: 'config.path.relative',
    params: null as unknown as Record<string, unknown>,
  }, 'plex', 'fr')).toBe('le chemin doit être absolu')
})
