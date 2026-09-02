import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { MemoryRouter } from 'react-router'
import { I18nProvider } from '../../src/i18n.tsx'
import { Nav } from '../../src/shell/Nav.tsx'

function renderNav(): void {
  render(<I18nProvider><MemoryRouter><Nav /></MemoryRouter></I18nProvider>)
}

describe('the primary nav', () => {
  it('names every item, including the desktop-only graph', () => {
    renderNav()
    expect(screen.getByText('Overview')).toBeDefined()
    expect(screen.getByText('Plugins')).toBeDefined()
    expect(screen.getByText('Sources')).toBeDefined()
    expect(screen.getByText('Roles')).toBeDefined()
    expect(screen.getByText('People')).toBeDefined()
    expect(screen.getByText('Network')).toBeDefined()
  })

  // Discriminates the `desktopOnly === true ? 'hidden md:flex' : ''` class: the graph link
  // must carry the hide-on-mobile class none of the other items carry.
  it('hides the graph link on mobile, unlike every other item', () => {
    renderNav()
    const graphLink = screen.getByText('Network').closest('a')
    const overviewLink = screen.getByText('Overview').closest('a')
    expect(graphLink?.className).toContain('hidden')
    expect(overviewLink?.className).not.toContain('hidden')
  })
})
