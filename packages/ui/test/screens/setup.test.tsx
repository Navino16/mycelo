import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { I18nProvider } from '../../src/i18n.tsx'
import { Setup } from '../../src/screens/Setup.tsx'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

function renderSetup(): void {
  render(<I18nProvider><Setup onDone={() => undefined} /></I18nProvider>)
}

describe('the setup wizard', () => {
  // The server refuses under 8 characters. A form that only learns this from a 400 makes
  // the operator's first act a failure.
  it('refuses a short password before asking the server', () => {
    const sent = mock(() => Promise.resolve(new Response('{}')))
    globalThis.fetch = sent
    renderSetup()

    fireEvent.change(screen.getByLabelText(/user/i), { target: { value: 'owner' } })
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'short' } })
    fireEvent.click(screen.getByRole('button', { name: /create/i }))

    expect(sent).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('8')
  })

  it('sends the credentials once the password is long enough', async () => {
    const calls: [string, RequestInit][] = []
    globalThis.fetch = mock((url: string, init: RequestInit) => {
      calls.push([url, init])
      return Promise.resolve(new Response('{"ok":true}', {
        headers: { 'content-type': 'application/json' },
      }))
    }) as unknown as typeof fetch
    renderSetup()

    fireEvent.change(screen.getByLabelText(/user/i), { target: { value: 'owner' } })
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'a-long-enough-one' } })
    fireEvent.click(screen.getByRole('button', { name: /create/i }))
    await Promise.resolve()

    const body = calls[0]?.[1].body
    expect(calls[0]?.[0]).toBe('/api/setup')
    expect(JSON.parse(typeof body === 'string' ? body : '')).toEqual({
      username: 'owner', password: 'a-long-enough-one',
    })
  })

  // X-Mycelo-Locale is inert on this route (no principal yet), so a server sentence would
  // always be in defaultLocale — never render it as the primary text on this screen.
  it('renders its own catalogue sentence on a conflict, not the server sentence', async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response(
      JSON.stringify({ error: { code: 'conflict', message: 'server says something else entirely' } }),
      { status: 409, headers: { 'content-type': 'application/json' } },
    )))
    renderSetup()

    fireEvent.change(screen.getByLabelText(/user/i), { target: { value: 'owner' } })
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'a-long-enough-one' } })
    fireEvent.click(screen.getByRole('button', { name: /create/i }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).not.toContain('server says something else entirely')
    expect(alert.textContent).toContain('exists')
  })
})
