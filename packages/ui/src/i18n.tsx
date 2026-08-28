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
  return globalThis.navigator?.language.startsWith('fr') === true ? 'fr' : 'en'
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

  return <I18nContext value={{ locale, setLocale: setLocaleState, t }}>{children}</I18nContext>
}

function useI18n(): I18n {
  const ctx = use(I18nContext)
  if (ctx === null) throw new Error('useI18n outside I18nProvider')
  return ctx
}

export function useT(): I18n['t'] { return useI18n().t }
export function useLocale(): Pick<I18n, 'locale' | 'setLocale'> {
  const { locale, setLocale } = useI18n()
  return { locale, setLocale }
}
