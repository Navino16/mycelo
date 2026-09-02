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

const SUBSTRATE = { startedAt: '2026-01-01T00:00:00.000Z', uptimeSeconds: 14 * 86_400 + 3 * 3_600 }

describe('the sidebar foot', () => {
  // packages/core/package.json is version 0.0.0 until phase 9.8 cuts the real one, so the
  // chrome would otherwise print `mycelo 0.0.0` on every deployment there has ever been.
  it('shows the uptime alone while the version is the 0.0.0 placeholder', () => {
    renderNav({ substrate: { ...SUBSTRATE, version: '0.0.0' } })

    expect(screen.getByText('up 14d 03h')).toBeDefined()
    expect(screen.queryByText(/mycelo 0\.0\.0/)).toBeNull()
    expect(screen.queryByText(/^mycelo/)).toBeNull()
  })

  it('names a real version beside the uptime', () => {
    renderNav({ substrate: { ...SUBSTRATE, version: '0.9.3' } })

    expect(screen.getByText('mycelo 0.9.3')).toBeDefined()
    expect(screen.getByText('up 14d 03h')).toBeDefined()
  })

  it('renders no foot before /api/substrate answers', () => {
    renderNav()

    expect(screen.queryByText(/^up /)).toBeNull()
  })
})
