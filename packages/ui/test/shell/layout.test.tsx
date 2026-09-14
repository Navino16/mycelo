import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { MemoryRouter, Route, Routes } from 'react-router'
import { HealthContext } from '../../src/health.tsx'
import { I18nProvider } from '../../src/i18n.tsx'
import { Layout } from '../../src/shell/Layout.tsx'
import type { RuntimeHealth } from '../../src/api/types.ts'

const HEALTHY: RuntimeHealth = {
  mode: 'germinated', dormant: [], enforcingBlocked: [], rhizas: [], hyphae: [], blockedSinceBoot: 0,
}

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
}

/** Renders the shell at a screen that is not the Overview. */
async function renderAt(path: string): Promise<void> {
  globalThis.fetch = mock((url: string) => {
    if (url === '/api/substrate') {
      return Promise.resolve(json({ version: '0.9.3', startedAt: '2026-01-01', uptimeSeconds: 14 * 86_400 }))
    }
    return Promise.resolve(json({}))
  }) as unknown as typeof fetch

  render(
    <I18nProvider>
      <HealthContext value={{ health: HEALTHY, error: false, refresh: () => Promise.resolve() }}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route path="plugins" element={<h1>Plugins</h1>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </HealthContext>
    </I18nProvider>,
  )
  await screen.findByRole('heading', { name: 'Plugins' })
}

describe('Layout, the chrome bar removed (1a-R4)', () => {
  it('renders no <header>: main is Layout\'s only content beside Nav', async () => {
    await renderAt('/plugins')

    expect(document.querySelector('header')).toBeNull()
  })
})

describe('the shell body clears the phone nav bar', () => {
  // Nav is `fixed bottom-0` under md, so without the padding the last row of every screen
  // sits behind it — unreachable on a phone, and invisible in a DOM-only test.
  it('pads the main region below the fixed bar, and drops the padding on desktop', async () => {
    await renderAt('/plugins')
    const main = document.querySelector('main')

    expect(main?.className).toContain('pb-20')
    expect(main?.className).toContain('md:pb-4')
  })
})
