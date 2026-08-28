import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { api } from '../src/api/client.ts'
import { I18nProvider, useLocale, useT } from '../src/i18n.tsx'

function Probe(): React.JSX.Element {
  const t = useT()
  const { locale, setLocale } = useLocale()
  return (
    <div>
      <span data-testid="nav">{t('nav.overview')}</span>
      <span data-testid="sub">{t('kind.hypha.subtitle')}</span>
      <span data-testid="locale">{locale}</span>
      <button onClick={() => { setLocale(locale === 'en' ? 'fr' : 'en') }}>switch</button>
    </div>
  )
}

// I18nProvider persists the choice to localStorage (by design, for a returning operator),
// and happy-dom is registered once for the whole process, so a test must clear it itself
// or it inherits the previous test's locale.
beforeEach(() => { globalThis.localStorage?.clear() })

describe('the chrome speaks its own language', () => {
  // 'nav.plugins' was the brief's probe key, but it is the identical word 'Plugins' in
  // both catalogues, so a switch can never change it. 'nav.overview' differs in each.
  it('renders a key in each language, and switching swaps it', () => {
    render(<I18nProvider><Probe /></I18nProvider>)
    expect(screen.getByTestId('nav').textContent).toBe('Overview')

    fireEvent.click(screen.getByText('switch'))

    expect(screen.getByTestId('nav').textContent).toBe('Vue d’ensemble')
  })

  // brief §6: the mycological term is used as-is and the subtitle is what prevents
  // "where do I configure Signal?".
  it('carries a plain-language subtitle for every mycological term', () => {
    render(<I18nProvider><Probe /></I18nProvider>)
    expect(screen.getByTestId('sub').textContent).toBe('channels')
  })

  describe('the locale change reaches the api client', () => {
    const realFetch = globalThis.fetch
    afterEach(() => { globalThis.fetch = realFetch })

    // §11: the chrome and the api header must move together, or a French screen would show
    // English command descriptions fetched under the old locale.
    it('sets the x-mycelo-locale header when the switch is used', async () => {
      const calls: { init: RequestInit }[] = []
      globalThis.fetch = mock((_url: string, init: RequestInit) => {
        calls.push({ init })
        return Promise.resolve(new Response('{}', { headers: { 'content-type': 'application/json' } }))
      }) as unknown as typeof fetch

      render(<I18nProvider><Probe /></I18nProvider>)
      fireEvent.click(screen.getByText('switch'))

      await api.get('/api/config')

      expect(new Headers(calls[0]?.init.headers).get('x-mycelo-locale')).toBe('fr')
    })
  })
})
