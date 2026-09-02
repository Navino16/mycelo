import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { AuthGate } from '../src/auth.tsx'
import { HealthProvider } from '../src/health.tsx'
import { I18nProvider } from '../src/i18n.tsx'
import { routes } from '../src/routes.tsx'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
}

function renderAt(path: string): void {
  globalThis.fetch = mock((url: string) => {
    if (url === '/api/me') return Promise.resolve(jsonResponse({ id: 'p1', username: 'owner', locale: 'en', roles: ['owner'] }))
    if (url === '/api/health') return Promise.resolve(jsonResponse({ mode: 'germinated', dormant: [], enforcingBlocked: [], rhizas: [] }))
    if (url.startsWith('/api/plugins/radarr')) return Promise.resolve(jsonResponse({ name: 'radarr', kind: 'rhiza', commands: [], state: 'germinated', enabled: true }))
    return Promise.resolve(jsonResponse({}))
  }) as unknown as typeof fetch

  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <I18nProvider>
      <AuthGate>
        <HealthProvider><RouterProvider router={router} /></HealthProvider>
      </AuthGate>
    </I18nProvider>,
  )
}

describe('the route wiring', () => {
  // Every screen test renders its own <Route> in isolation; only this file exercises the
  // actual `routes` array a path typo here would otherwise slip past unnoticed.
  it('reaches the plugin settings screen at its real nested path', async () => {
    renderAt('/plugins/radarr/settings')

    await waitFor(() => { expect(screen.getByRole('heading', { name: 'radarr' })).toBeDefined() })
  })
})
