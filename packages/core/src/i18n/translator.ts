import type { Logger } from '@mycelo/septum'
import type { Catalogs } from './catalog.js'

export interface Translator {
  translate(domain: string, key: string, locale: string, params?: Record<string, unknown>): string
  /** Locales for which at least one catalogue exists, canonical BCP-47, sorted. */
  availableLocales(): readonly string[]
}

// IntlMessageFormat.format is typed `string | T | (string | T)[]` because a caller may pass
// rich-text element functions. Nothing here does, so every result is a string.
function asText(value: unknown): string {
  return typeof value === 'string' ? value : String(value)
}

/**
 * design §7.2: the requested locale, then the default, then the key itself. A missing key
 * never throws and never returns undefined — an untranslated phrase is not worth a broken
 * reply — but it is warned about once, so a partial contribution stays visible.
 */
export function createTranslator(options: {
  catalogs: Catalogs
  defaultLocale: string
  logger: Logger
}): Translator {
  const { catalogs, defaultLocale, logger } = options
  const warned = new Set<string>()

  return {
    translate(domain, key, locale, params) {
      const byLocale = catalogs.get(domain)
      // Warn on the direct lookup, not the fallback result: a locale whose catalogue lacks
      // this key is an incomplete contribution even when the default covers it.
      const direct = byLocale?.get(locale)?.get(key)
      const message = direct ?? byLocale?.get(defaultLocale)?.get(key)
      if (direct === undefined) {
        const once = `${domain}|${key}|${locale}`
        if (!warned.has(once)) {
          warned.add(once)
          logger.warn(`no translation for '${key}' in domain '${domain}'`, { locale })
        }
      }
      if (message === undefined) {
        // Returned literally, never through ICU: a `respond: "type {help}"` used as its own
        // key would otherwise fail to parse (design §5.2).
        return key
      }
      try {
        // The values a plugin passes are unknown by type; IntlMessageFormat accepts
        // primitives and Dates and reports anything else at format time.
        return asText(message.format(params as Record<string, string | number | boolean | Date | null | undefined>))
      } catch (e) {
        logger.error(`could not format '${key}' in domain '${domain}'`, {
          locale,
          error: (e as Error).message,
        })
        return key
      }
    },
    availableLocales() {
      const all = new Set<string>()
      for (const byLocale of catalogs.values()) for (const locale of byLocale.keys()) all.add(locale)
      return [...all].sort()
    },
  }
}
