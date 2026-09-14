import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { MemoryRouter } from 'react-router'
import { ChromeContext } from '../../src/chrome.tsx'
import { PageHeader } from '../../src/components/PageHeader.tsx'
import { HealthContext } from '../../src/health.tsx'
import { I18nProvider } from '../../src/i18n.tsx'
import { Nav } from '../../src/shell/Nav.tsx'
import type { ChromeValue } from '../../src/chrome.tsx'
import type { RuntimeHealth } from '../../src/api/types.ts'

const COUNTS = { plugins: 32, issues: 5, sources: 2, roles: 7, people: 128 }

const HEALTHY: RuntimeHealth = {
  mode: 'germinated', dormant: [], enforcingBlocked: [], rhizas: [], hyphae: [], blockedSinceBoot: 0,
}

/**
 * A ChromeContext value rather than ChromeProvider: Nav reads the counts and never fetches
 * them, so a provider here would only add five fetch mocks with nothing to assert.
 */
function renderNav(chrome: Partial<ChromeValue> = {}): void {
  const value: ChromeValue = { substrate: null, counts: null, host: 'substrate.home.lan', ...chrome }
  render(
    <I18nProvider>
      <MemoryRouter>
        <ChromeContext value={value}><Nav /></ChromeContext>
      </MemoryRouter>
    </I18nProvider>,
  )
}

describe('the primary nav', () => {
  it('names every item, including the desktop-only graph', () => {
    renderNav()
    expect(screen.getByText('Overview')).toBeDefined()
    expect(screen.getByText('Plugins')).toBeDefined()
    expect(screen.getByText('Sources')).toBeDefined()
    expect(screen.getByText('Roles')).toBeDefined()
    expect(screen.getByText('People')).toBeDefined()
    expect(screen.getByText('Anastomosis')).toBeDefined()
  })

  // 1a-R5: the rename applies at both widths, so the same key change covers the phone
  // bar and the desktop sidebar with nothing left to discriminate between them.
  it('reads Aperçu, not Vue d’ensemble, in French', () => {
    globalThis.localStorage?.setItem('mycelo.locale', 'fr')
    try {
      renderNav()

      expect(screen.getByText('Aperçu')).toBeDefined()
      expect(screen.queryByText('Vue d’ensemble')).toBeNull()
    } finally {
      globalThis.localStorage?.removeItem('mycelo.locale')
    }
  })

  // Discriminates the `desktopOnly === true ? 'hidden md:flex' : ''` class: the graph link
  // must carry the hide-on-mobile class none of the other items carry.
  it('hides the graph link on mobile, unlike every other item', () => {
    renderNav()
    const graphLink = screen.getByText('Anastomosis').closest('a')
    const overviewLink = screen.getByText('Overview').closest('a')
    expect(graphLink?.className).toContain('hidden')
    expect(overviewLink?.className).not.toContain('hidden')
  })

  // The deliberate divergence recorded in this plan: five phone items, not the design's four.
  it('keeps Sources reachable on the phone bar', () => {
    renderNav({ counts: COUNTS })

    expect(screen.getByRole('link', { name: /^Sources/ }).className).not.toContain('hidden')
  })

  it('hides only the graph below md', () => {
    renderNav({ counts: COUNTS })

    expect(screen.getByRole('link', { name: /^Anastomosis/ }).className).toContain('hidden')
  })

  // happy-dom performs no layout, so a phone-bar item's rect stays zero regardless of the
  // fix. Pin the shrink mechanism: the item must shrink below its label's content width
  // (row 33's five-item bar). 'Overview' no longer needs the wrap workaround the shorter
  // 'Aperçu' made unnecessary (1a-R5), so the label carries no break-words class.
  it('lets a phone-bar item shrink across five columns', () => {
    renderNav()

    const link = screen.getByRole('link', { name: /^Overview/ })
    expect(link.className.split(/\s+/)).toContain('min-w-0')
    expect(screen.getByText('Overview').className.split(/\s+/)).not.toContain('break-words')
  })
})

describe('the sidebar counts', () => {
  // 1a-overview-desktop-degraded.png: Overview 5, Plugins 32, Sources 2, Roles 7, People 128,
  // and Anastomosis with none. Every count from the same table, not just the first.
  it('shows every count the design draws, and none beside the graph', () => {
    renderNav({ counts: COUNTS })

    expect(screen.getByRole('link', { name: /^Overview/ }).textContent).toBe('Overview5')
    expect(screen.getByRole('link', { name: /^Plugins/ }).textContent).toBe('Plugins32')
    expect(screen.getByRole('link', { name: /^People/ }).textContent).toBe('People128')
    expect(screen.getByRole('link', { name: /^Anastomosis/ }).textContent).toBe('Anastomosis')
  })

  it('renders no count at all before the first answer', () => {
    renderNav()

    expect(screen.getByRole('link', { name: /^Overview/ }).textContent).toBe('Overview')
  })

  // `problem: true` is what makes a count amber: Overview counts faults, Plugins counts a size,
  // and painting a size amber would make a healthy 32-plugin substrate look broken.
  it('paints the fault count amber and the size counts neutral', () => {
    renderNav({ counts: COUNTS })

    expect(screen.getByText('5').className).toContain('text-warn')
    expect(screen.getByText('32').className).not.toContain('text-warn')
  })

  it('leaves the fault count neutral when there is no fault', () => {
    renderNav({ counts: { ...COUNTS, issues: 0 } })

    expect(screen.getByText('0').className).not.toContain('text-warn')
  })
})

const SUBSTRATE = { version: '0.9.3', startedAt: '2026-01-01T00:00:00.000Z', uptimeSeconds: 14 * 86_400 + 3 * 3_600 }

describe('the sidebar foot', () => {
  // The line's own content is pinned on useUptimeLine (test/shell/chrome.test.tsx); this is
  // the claim that the foot consumes the hook rather than formatting a second time.
  it('renders the chrome line the hook returns', () => {
    renderNav({ substrate: SUBSTRATE })

    expect(screen.getByText('mycelo 0.9.3 · up 14d 03h')).toBeDefined()
  })

  // packages/core/package.json's real, released version: the value this task bumps it to.
  it('names the released version beside the uptime', () => {
    renderNav({ substrate: { ...SUBSTRATE, version: '0.1.0' } })

    expect(screen.getByText('mycelo 0.1.0 · up 14d 03h')).toBeDefined()
  })

  it('suppresses the 0.0.0 placeholder without hiding the uptime', () => {
    renderNav({ substrate: { ...SUBSTRATE, version: '0.0.0' } })

    const line = screen.getByText(/up 14d 03h/)
    expect(line.textContent).not.toContain('0.0.0')
  })

  it('renders no foot at all when the hook has nothing to show', () => {
    renderNav({ substrate: { ...SUBSTRATE, uptimeSeconds: Number.NaN } })

    expect(screen.queryByText(/up /)).toBeNull()
  })

  it('renders no foot before /api/substrate answers', () => {
    renderNav()

    expect(screen.queryByText(/^up /)).toBeNull()
  })

  // 1a-R1: language and theme move out of the chrome bar task 3 deletes and into the
  // sidebar. They must not depend on /api/substrate: an operator switching language
  // should not need the uptime line to have loaded first.
  it('carries the language switch and theme toggle above the uptime line', () => {
    renderNav()

    const select = screen.getByRole('combobox')
    const toggle = screen.getByRole('button')
    const wrapper = select.closest('[data-testid="nav-desktop-controls"]')

    expect(wrapper).not.toBeNull()
    expect(wrapper?.contains(toggle)).toBe(true)
  })

  // happy-dom evaluates no media query, so rendering Nav and PageHeader together puts two
  // language selects in the DOM. Correct, provided exactly one is gated for each width —
  // tokenised, since toContain('md:hidden') is satisfied by 'max-md:hidden'.
  it('is the only visible language control above md when rendered beside PageHeader', () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <HealthContext value={{ health: HEALTHY, error: false, refresh: () => Promise.resolve() }}>
            <ChromeContext value={{ substrate: null, counts: null, host: 'substrate.home.lan' }}>
              <Nav />
              <PageHeader title="Overview" />
            </ChromeContext>
          </HealthContext>
        </MemoryRouter>
      </I18nProvider>,
    )

    const selects = screen.getAllByRole('combobox')
    expect(selects).toHaveLength(2)

    const desktopWrapper = selects
      .map((s) => s.closest('[data-testid="nav-desktop-controls"]'))
      .find((w) => w !== null)
    const mobileWrapper = selects
      .map((s) => s.closest('[data-testid="pageheader-mobile-controls"]'))
      .find((w) => w !== null)

    expect(desktopWrapper).not.toBeUndefined()
    expect(mobileWrapper).not.toBeUndefined()

    const desktopFoot = desktopWrapper?.closest('div.hidden')
    expect(desktopFoot?.className.split(/\s+/)).toContain('md:block')
    expect(desktopFoot?.className.split(/\s+/)).not.toContain('md:hidden')

    expect(mobileWrapper?.className.split(/\s+/)).toContain('md:hidden')
    expect(mobileWrapper?.className.split(/\s+/)).not.toContain('md:block')
  })
})

describe('the phone bar', () => {
  // 1a-overview-mobile-degraded.png marks the active item with an accent rule on its top edge
  // and accent ink. Text opacity alone — which is all this carried — is not a state.
  it('marks the active item with the accent rule and the accent ink', () => {
    renderNav()
    const active = screen.getByRole('link', { name: /^Overview/ })

    expect(active.getAttribute('aria-current')).toBe('page')
    expect(active.className).toContain('text-accent')
    expect(active.className).toContain('border-accent')
  })

  it('leaves every inactive item without the accent', () => {
    renderNav()
    const inactive = screen.getByRole('link', { name: /^Plugins/ })

    expect(inactive.getAttribute('aria-current')).toBeNull()
    expect(inactive.className).not.toContain('text-accent')
    expect(inactive.className).not.toContain('border-accent')
  })

  // The rule must not become a separator on the desktop sidebar, which fills the row instead.
  it('drops the rule and fills the row instead above md', () => {
    renderNav()
    const active = screen.getByRole('link', { name: /^Overview/ })

    expect(active.className).toContain('md:border-t-0')
    expect(active.className).toContain('md:bg-surface2')
  })
})
