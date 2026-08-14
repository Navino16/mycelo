import { describe, expect, it } from 'bun:test'
import type { Logger } from '@mycelo/septum'
import { catalogsOf } from '../support/catalogs.js'
import { createTranslator } from '../../src/i18n/translator.js'

interface Recorded { level: string, message: string }

function recorder(): { logger: Logger, records: Recorded[] } {
  const records: Recorded[] = []
  const logger: Logger = {
    debug: (message) => { records.push({ level: 'debug', message }) },
    info: (message) => { records.push({ level: 'info', message }) },
    warn: (message) => { records.push({ level: 'warn', message }) },
    error: (message) => { records.push({ level: 'error', message }) },
    child: () => logger,
  }
  return { logger, records }
}

describe('createTranslator', () => {
  it('formats a key in the requested locale', () => {
    const { logger } = recorder()
    const t = createTranslator({
      catalogs: catalogsOf({ media: { en: { found: 'found {title}' }, fr: { found: 'trouvé {title}' } } }),
      defaultLocale: 'en',
      logger,
    })
    expect(t.translate('media', 'found', 'fr', { title: 'Dune' })).toBe('trouvé Dune')
    expect(t.translate('media', 'found', 'en', { title: 'Dune' })).toBe('found Dune')
  })

  it('falls back to the default locale for a key the requested one is missing, and warns', () => {
    const { logger, records } = recorder()
    const t = createTranslator({
      catalogs: catalogsOf({ media: { en: { found: 'found it' }, fr: { other: 'autre' } } }),
      defaultLocale: 'en',
      logger,
    })
    expect(t.translate('media', 'found', 'fr')).toBe('found it')
    expect(records.filter((r) => r.level === 'warn')).toHaveLength(1)
    expect(records[0]?.message).toContain('found')
  })

  it('returns the key itself when no locale has it', () => {
    const { logger, records } = recorder()
    const t = createTranslator({ catalogs: catalogsOf({ ping: { en: {} } }), defaultLocale: 'en', logger })
    expect(t.translate('ping', 'pong', 'fr')).toBe('pong')
    expect(records.some((r) => r.level === 'warn')).toBe(true)
  })

  it('returns the key for an unknown domain rather than throwing', () => {
    const { logger } = recorder()
    const t = createTranslator({ catalogs: catalogsOf({}), defaultLocale: 'en', logger })
    expect(t.translate('nobody', 'some.key', 'en')).toBe('some.key')
  })

  it('does not pass an absent key through ICU, so a brace survives literally', () => {
    const { logger } = recorder()
    const t = createTranslator({ catalogs: catalogsOf({ ping: { en: {} } }), defaultLocale: 'en', logger })
    expect(t.translate('ping', 'type {help}', 'en')).toBe('type {help}')
  })

  it('warns once per (domain, key, locale), not once per call', () => {
    const { logger, records } = recorder()
    const t = createTranslator({ catalogs: catalogsOf({ ping: { en: {} } }), defaultLocale: 'en', logger })
    t.translate('ping', 'pong', 'fr')
    t.translate('ping', 'pong', 'fr')
    t.translate('ping', 'pong', 'de')
    expect(records.filter((r) => r.level === 'warn')).toHaveLength(2)
  })

  it('returns the key and logs an error when a parameter the message needs is missing', () => {
    const { logger, records } = recorder()
    const t = createTranslator({
      catalogs: catalogsOf({ media: { en: { found: 'found {title}' } } }),
      defaultLocale: 'en',
      logger,
    })
    expect(t.translate('media', 'found', 'en')).toBe('found')
    expect(records.filter((r) => r.level === 'error')).toHaveLength(1)
  })

  it('formats Russian plurals, including the many form no count===1 branch reaches', () => {
    const { logger } = recorder()
    const t = createTranslator({
      catalogs: catalogsOf({
        media: { ru: { count: '{n, plural, one {# фильм} few {# фильма} many {# фильмов} other {# фильма}}' } },
      }),
      defaultLocale: 'ru',
      logger,
    })
    expect(t.translate('media', 'count', 'ru', { n: 1 })).toBe('1 фильм')
    expect(t.translate('media', 'count', 'ru', { n: 3 })).toBe('3 фильма')
    expect(t.translate('media', 'count', 'ru', { n: 5 })).toBe('5 фильмов')
  })

  it('lists every locale any domain provides, sorted and deduplicated', () => {
    const { logger } = recorder()
    const t = createTranslator({
      catalogs: catalogsOf({ media: { fr: {}, en: {} }, admin: { en: {}, ru: {} } }),
      defaultLocale: 'en',
      logger,
    })
    // Three domains' worth of overlap, not one: a union collapsed to the last domain read
    // would still answer a plausible-looking list.
    expect(t.availableLocales()).toEqual(['en', 'fr', 'ru'])
  })
})
