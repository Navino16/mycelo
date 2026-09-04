import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { I18nProvider } from '../../src/i18n.tsx'
import { Setup } from '../../src/screens/Setup.tsx'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

function renderSetup(): void {
  render(<I18nProvider><Setup onDone={() => undefined} /></I18nProvider>)
}

function fill(username: string, password: string, repeat: string): void {
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: username } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } })
  fireEvent.change(screen.getByLabelText('Repeat password'), { target: { value: repeat } })
}

function submitButton(): HTMLButtonElement {
  return screen.getByRole<HTMLButtonElement>('button', { name: 'Create the account' })
}

describe('the setup wizard', () => {
  // 2a's own rule. Three independent reasons, asserted one at a time: a gate wired to the
  // password alone passes a test that only ever leaves the password short.
  it('keeps the button inert until every reason to refuse is gone', () => {
    renderSetup()

    expect(submitButton().disabled).toBe(true)

    fill('', 'correct horse', 'correct horse')
    expect(submitButton().disabled).toBe(true)

    fill('owner', 'short', 'short')
    expect(submitButton().disabled).toBe(true)

    fill('owner', 'correct horse', 'correct hors')
    expect(submitButton().disabled).toBe(true)

    fill('owner', 'correct horse', 'correct horse')
    expect(submitButton().disabled).toBe(false)
  })

  // The server refuses under 8 characters. A form that only learns this from a 400 makes the
  // operator's first act a failure, so the rule is visible and the button never fires.
  it('refuses a short password before asking the server, and says why', () => {
    const sent = mock(() => Promise.resolve(new Response('{}')))
    globalThis.fetch = sent
    renderSetup()

    fill('owner', 'short', 'short')
    fireEvent.click(submitButton())

    expect(sent).not.toHaveBeenCalled()
    expect(screen.getByText('At least 8 characters.')).toBeDefined()
  })

  it('names the mismatch rather than only staying inert', () => {
    renderSetup()

    fill('owner', 'correct horse', 'correct hors')

    expect(screen.getByText('The two passwords do not match.')).toBeDefined()
  })

  // Discriminates the mismatch line from one rendered whenever the two differ: an untouched
  // repeat field is not a mismatch the operator made.
  it('says nothing about a mismatch while the repeat field is still empty', () => {
    renderSetup()

    fill('owner', 'correct horse', '')

    expect(screen.queryByText('The two passwords do not match.')).toBeNull()
  })

  it('reveals both passwords when asked, and hides them again', () => {
    renderSetup()

    fireEvent.click(screen.getByRole('button', { name: 'Show' }))
    expect(screen.getByLabelText('Password').getAttribute('type')).toBe('text')
    expect(screen.getByLabelText('Repeat password').getAttribute('type')).toBe('text')

    fireEvent.click(screen.getByRole('button', { name: 'Hide' }))
    expect(screen.getByLabelText('Password').getAttribute('type')).toBe('password')
    expect(screen.getByLabelText('Repeat password').getAttribute('type')).toBe('password')
  })

  // 2a's eyebrow. Setup renders outside ChromeProvider, so the host cannot come from useChrome().
  it('shows the host it is running on', () => {
    renderSetup()

    expect(screen.getByText(globalThis.location.host)).toBeDefined()
  })

  it('sends the credentials once the form is valid', async () => {
    const calls: [string, RequestInit][] = []
    globalThis.fetch = mock((url: string, init: RequestInit) => {
      calls.push([url, init])
      return Promise.resolve(new Response('{"ok":true}', {
        headers: { 'content-type': 'application/json' },
      }))
    }) as unknown as typeof fetch
    renderSetup()

    fill('owner', 'a-long-enough-one', 'a-long-enough-one')
    fireEvent.click(submitButton())
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

    fill('owner', 'a-long-enough-one', 'a-long-enough-one')
    fireEvent.click(submitButton())

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).not.toContain('server says something else entirely')
    expect(alert.textContent).toContain('exists')
  })
})
