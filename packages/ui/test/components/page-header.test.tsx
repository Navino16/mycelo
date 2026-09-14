import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { ChromeContext } from '../../src/chrome.tsx'
import { PageHeader } from '../../src/components/PageHeader.tsx'
import { HealthContext } from '../../src/health.tsx'
import { I18nProvider } from '../../src/i18n.tsx'
import type { ChromeValue } from '../../src/chrome.tsx'
import type { RuntimeHealth } from '../../src/api/types.ts'
import type { ReactNode } from 'react'

const HEALTHY: RuntimeHealth = {
  mode: 'germinated', dormant: [], enforcingBlocked: [], rhizas: [], hyphae: [], blockedSinceBoot: 0,
}

const CHROME: ChromeValue = { substrate: null, counts: { plugins: 4 }, host: '' }

function renderHeader(
  props: { title?: ReactNode, subtitle?: ReactNode, actions?: ReactNode } = {},
): void {
  render(
    <I18nProvider>
      <HealthContext value={{ health: HEALTHY, error: false, refresh: () => Promise.resolve() }}>
        <ChromeContext value={CHROME}>
          <PageHeader title="Overview" {...props} />
        </ChromeContext>
      </HealthContext>
    </I18nProvider>,
  )
}

describe('PageHeader', () => {
  it('renders the passed title node in the h1', () => {
    renderHeader({ title: <span>Substrate</span> })

    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading.textContent).toBe('Substrate')
  })

  it('shows the health pill', () => {
    renderHeader()

    expect(screen.getByRole('status')).toBeDefined()
  })

  // happy-dom evaluates no media query, so both variants are always in the DOM: assert on the
  // token, never on visibility, and tokenise or 'md:hidden' would pass against 'max-md:hidden'.
  it('carries the language switch and theme toggle, hidden above md', () => {
    renderHeader()

    const select = screen.getByRole('combobox')
    const toggle = screen.getByRole('button')
    const wrapper = select.closest('[data-testid="pageheader-mobile-controls"]')

    expect(wrapper).not.toBeNull()
    expect(wrapper?.contains(toggle)).toBe(true)
    expect(wrapper?.className.split(/\s+/)).toContain('md:hidden')
  })

  it('renders no actions slot when none are passed, and the slot when they are', () => {
    renderHeader()
    expect(screen.queryByTestId('pageheader-actions')).toBeNull()

    renderHeader({ actions: <button type="button">Search</button> })
    expect(screen.getByTestId('pageheader-actions')).toBeDefined()
    expect(screen.getAllByText('Search').some((el) => el.tagName === 'BUTTON')).toBe(true)
  })
})
