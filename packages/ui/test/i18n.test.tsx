import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { api } from '../src/api/client.ts'
import { I18nProvider, plural, useLocale, useT } from '../src/i18n.tsx'
import { LanguageSwitch } from '../src/shell/LanguageSwitch.tsx'

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

  // Probe's own button proves the setter and the catalogues agree; this proves the shipped
  // control actually calls it — an inverted ternary in LanguageSwitch.tsx left this suite
  // green until this test existed.
  it('changes the rendered chrome when the real language control is used', () => {
    render(<I18nProvider><LanguageSwitch /><Probe /></I18nProvider>)
    expect(screen.getByTestId('nav').textContent).toBe('Overview')

    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'fr' } })

    expect(screen.getByTestId('nav').textContent).toBe('Vue d’ensemble')
  })

  // The select's own value-switching worked while its French <option> rendered the six
  // literal characters "Fran\u00e7ais" (fix round 1's regression): asserts the rendered
  // text itself, not just that choosing it changes the locale elsewhere.
  it("renders the French option's own text correctly, not the escape literally", () => {
    const { container } = render(<I18nProvider><LanguageSwitch /></I18nProvider>)
    const option = container.querySelector('option[value="fr"]')

    expect(option?.textContent).toBe('Français')
  })

  // Discriminates `stored === 'en' || stored === 'fr'` from a bare `=== 'en'`: a stored
  // French preference must survive a reload, not just an in-session switch.
  it('opens in French when localStorage remembers a French preference', () => {
    globalThis.localStorage?.setItem('mycelo.locale', 'fr')
    try {
      render(<I18nProvider><Probe /></I18nProvider>)
      expect(screen.getByTestId('locale').textContent).toBe('fr')
    } finally {
      globalThis.localStorage?.removeItem('mycelo.locale')
    }
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

function Plurals(): React.JSX.Element {
  const t = useT()
  const { locale, setLocale } = useLocale()
  return (
    <div>
      <span data-testid="zero">{plural(t, 'person.identityCount', 0, { count: 0 })}</span>
      <span data-testid="one">{plural(t, 'person.identityCount', 1, { count: 1 })}</span>
      <span data-testid="two">{plural(t, 'person.identityCount', 2, { count: 2 })}</span>
      {/* English is identical on both halves of this pair, so only French can fail it. */}
      <span data-testid="kind">{plural(t, 'kind.meta', 1, { count: 3, dormant: 1 })}</span>
      <button onClick={() => { setLocale(locale === 'en' ? 'fr' : 'en') }}>switch</button>
    </div>
  )
}

describe('the plural helper', () => {
  // The twenty-nine hand-written ternaries it replaces each named their own sibling key, so
  // each was its own chance to name the wrong one.
  it('selects the One variant at exactly 1, and the plural at 0 and above 1', () => {
    render(<I18nProvider><Plurals /></I18nProvider>)

    expect(screen.getByTestId('one').textContent).toBe('1 identity')
    expect(screen.getByTestId('zero').textContent).toBe('0 identities')
    expect(screen.getByTestId('two').textContent).toBe('2 identities')
  })

  // Minor 3: three pairs are word-for-word identical in English, so an English-only assertion
  // over them cannot fail. The French half is what discriminates.
  it('selects the One variant in French too, where the two halves differ', () => {
    render(<I18nProvider><Plurals /></I18nProvider>)
    fireEvent.click(screen.getByText('switch'))

    expect(screen.getByTestId('kind').textContent).toBe('3 \u00b7 1 dormant')
    expect(screen.getByTestId('one').textContent).toBe('1 identit\u00e9')
    expect(screen.getByTestId('two').textContent).toBe('2 identit\u00e9s')
  })
})
