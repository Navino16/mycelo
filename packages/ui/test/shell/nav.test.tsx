import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { MemoryRouter } from 'react-router'
import { ChromeContext } from '../../src/chrome.tsx'
import { I18nProvider } from '../../src/i18n.tsx'
import { Nav } from '../../src/shell/Nav.tsx'
import type { ChromeValue } from '../../src/chrome.tsx'

const COUNTS = { plugins: 32, issues: 5, sources: 2, roles: 7, people: 128 }

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

  it('renders no foot at all when the hook has nothing to show', () => {
    renderNav({ substrate: { ...SUBSTRATE, uptimeSeconds: Number.NaN } })

    expect(screen.queryByText(/up /)).toBeNull()
  })

  it('renders no foot before /api/substrate answers', () => {
    renderNav()

    expect(screen.queryByText(/^up /)).toBeNull()
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
