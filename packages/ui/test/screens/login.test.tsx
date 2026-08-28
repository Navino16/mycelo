import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { I18nProvider } from '../../src/i18n.tsx'
import { Login } from '../../src/screens/Login.tsx'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

function renderLogin(): void {
  render(<I18nProvider><Login onDone={() => undefined} /></I18nProvider>)
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('the login screen', () => {
  it('names a wrong password, not the server sentence', async () => {
    globalThis.fetch = mock(() => Promise.resolve(jsonResponse(
      401, { error: { code: 'unauthenticated', message: 'server says something else entirely' } },
    )))
    renderLogin()

    fireEvent.change(screen.getByLabelText(/user/i), { target: { value: 'owner' } })
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).not.toContain('server says something else entirely')
    expect(alert.textContent).toContain('refused')
  })

  // A rate limit or a store fault is not "wrong credentials"; naming it that way as misleading.
  it('falls back to a generic sentence for a code other than unauthenticated', async () => {
    globalThis.fetch = mock(() => Promise.resolve(jsonResponse(
      429, { error: { code: 'rate-limited', message: 'too many attempts' } },
    )))
    renderLogin()

    fireEvent.change(screen.getByLabelText(/user/i), { target: { value: 'owner' } })
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'whatever' } })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).not.toContain('too many attempts')
    expect(alert.textContent).not.toContain('refused')
  })

  it('calls onDone once the credentials are accepted', async () => {
    globalThis.fetch = mock(() => Promise.resolve(jsonResponse(200, { ok: true })))
    let done = false
    render(<I18nProvider><Login onDone={() => { done = true }} /></I18nProvider>)

    fireEvent.change(screen.getByLabelText(/user/i), { target: { value: 'owner' } })
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'correct' } })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => { expect(done).toBe(true) })
  })
})
