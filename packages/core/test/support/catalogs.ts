import { IntlMessageFormat } from 'intl-messageformat'
import type { Catalogs } from '../../src/i18n/catalog.js'

/** Builds a Catalogs map from plain literals: domain → locale → key → ICU source. */
export function catalogsOf(entries: Record<string, Record<string, Record<string, string>>>): Catalogs {
  return new Map(Object.entries(entries).map(([domain, locales]) => [
    domain,
    new Map(Object.entries(locales).map(([locale, messages]) => [
      locale,
      new Map(Object.entries(messages).map(([key, text]) => [key, new IntlMessageFormat(text, locale)])),
    ])),
  ]))
}
