import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { AuthGate } from '../src/auth.tsx'
import { I18nProvider } from '../src/i18n.tsx'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function renderGate(): void {
  render(
    <I18nProvider>
      <AuthGate><div>protected content</div></AuthGate>
    </I18nProvider>,
  )
}

describe('AuthGate', () => {
  // The path a fresh browser takes: no session cookie, /api/me answers 401. client.ts's
  // notify('login') must reach the gate and swap the screen, not merely reject a promise.
  it('shows the login screen when /api/me answers 401', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(jsonResponse(401, { error: { code: 'unauthenticated', message: 'x' } })),
    )
    renderGate()

    await screen.findByRole('heading', { name: 'Sign in' })
    expect(screen.queryByText('protected content')).toBeNull()
  })

  // The path a fresh substrate takes: no account exists yet, /api/me answers 503 setup-required.
  it('shows the setup wizard when /api/me answers a setup-required 503', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(jsonResponse(503, { error: { code: 'setup-required', message: 'x' } })),
    )
    renderGate()

    await screen.findByText('Create the owner account')
    expect(screen.queryByText('protected content')).toBeNull()
  })

  it('renders the children once /api/me answers', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(jsonResponse(200, { id: 'p1', username: 'owner', locale: 'en', roles: ['owner'] })),
    )
    renderGate()

    await screen.findByText('protected content')
  })
})
