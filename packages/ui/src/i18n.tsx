import { createContext, use, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { en } from '../locales/en.ts'
import type { StringKey } from '../locales/en.ts'
import { fr } from '../locales/fr.ts'
import { setLocaleHeader } from './api/client.ts'

export type Locale = 'en' | 'fr'

const CATALOGUES: Record<Locale, Record<StringKey, string>> = { en, fr }

interface I18n {
  locale: Locale
  setLocale: (next: Locale) => void
  t: (key: StringKey, params?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18n | null>(null)

function initialLocale(): Locale {
  const stored = globalThis.localStorage?.getItem('mycelo.locale')
  if (stored === 'en' || stored === 'fr') return stored
  return globalThis.navigator?.language?.startsWith('fr') === true ? 'fr' : 'en'
}

export function I18nProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [locale, setLocaleState] = useState<Locale>(initialLocale)

  // The header and the bundled strings move together: a French chrome over English
  // command descriptions is exactly what spec §11 exists to prevent.
  useEffect(() => {
    setLocaleHeader(locale)
    globalThis.localStorage?.setItem('mycelo.locale', locale)
    document.documentElement.setAttribute('lang', locale)
  }, [locale])

  const t = (key: StringKey, params?: Record<string, string | number>): string => {
    const raw = CATALOGUES[locale][key]
    if (params === undefined) return raw
    return Object.entries(params).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), raw)
  }

  // Header first, state second: a screen whose fetch effect depends on the locale runs that
  // effect before this provider's own, and would otherwise resend the old language (defect 31).
  const setLocale = (next: Locale): void => { setLocaleHeader(next); setLocaleState(next) }

  return <I18nContext value={{ locale, setLocale, t }}>{children}</I18nContext>
}

function useI18n(): I18n {
  const ctx = use(I18nContext)
  if (ctx === null) throw new Error('useI18n outside I18nProvider')
  return ctx
}

export type Translate = I18n['t']

/** A key whose `…One` sibling exists: the two halves of one plural pair (ruling C12). */
export type PluralKey = { [K in StringKey]: `${K}One` extends StringKey ? K : never }[StringKey]

/**
 * The `…One` variant at exactly 1, the plural otherwise. Twenty-nine hand-written ternaries
 * did this, which is twenty-nine chances to name the wrong sibling.
 */
export function plural(
  t: Translate, base: PluralKey, count: number, params?: Record<string, string | number>,
): string {
  // PluralKey guarantees the sibling is a key; the compiler cannot follow that through here.
  return t(count === 1 ? `${base}One` as StringKey : base, params)
}

export function useT(): Translate { return useI18n().t }
export function useLocale(): Pick<I18n, 'locale' | 'setLocale'> {
  const { locale, setLocale } = useI18n()
  return { locale, setLocale }
}
