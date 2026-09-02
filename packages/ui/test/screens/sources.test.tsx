import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { MemoryRouter } from 'react-router'
import { I18nProvider } from '../../src/i18n.tsx'
import { Sources } from '../../src/screens/Sources.tsx'
import type { SourceDto } from '../../src/api/types.ts'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

const OFFICIAL: SourceDto = {
  id: 1, label: 'Official registry', driver: 'github', location: 'https://github.com/x/y', official: true, enabled: true,
}
const THIRD_PARTY: SourceDto = {
  id: 2,
  label: 'My mirror',
  driver: 'github',
  location: 'https://github.com/a/b',
  official: false,
  enabled: true,
  token: '••••',
}
const DISABLED: SourceDto = {
  id: 3, label: 'Old one', driver: 'github', location: 'https://github.com/c/d', official: false, enabled: false,
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

interface Call { method: string, url: string, body: unknown }

/** A stateful fake serving the four routes Sources.tsx calls, tracking every call it saw. */
function mockApi(initial: readonly SourceDto[]): { calls: Call[] } {
  const calls: Call[] = []
  let list = [...initial]
  globalThis.fetch = mock((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ method, url, body })

    if (method === 'GET' && url === '/api/sources') return Promise.resolve(json(list))

    if (method === 'POST' && url === '/api/sources') {
      const created = { id: list.length + 1, driver: 'github', official: false, enabled: true, ...body as object }
      list = [...list, created as SourceDto]
      return Promise.resolve(json(created))
    }

    const patch = /^\/api\/sources\/(\d+)$/.exec(url)
    if (method === 'PATCH' && patch !== null) {
      const id = Number(patch[1])
      list = list.map((s) => (s.id === id ? { ...s, ...body as object } : s))
      return Promise.resolve(json(list.find((s) => s.id === id)))
    }

    return Promise.resolve(json({ error: { message: 'unhandled in test' } }, 404))
  }) as unknown as typeof fetch
  return { calls }
}

function renderSources(): void {
  render(<I18nProvider><MemoryRouter><Sources /></MemoryRouter></I18nProvider>)
}

describe('the sources list', () => {
  it('says something went wrong when the fetch fails, rather than staying blank', async () => {
    globalThis.fetch = mock(() => Promise.resolve(json({ error: { message: 'x' } }, 500)))
    renderSources()

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Something went wrong')
  })

  it('renders the list on success, with no error banner', async () => {
    mockApi([OFFICIAL])
    renderSources()

    await waitFor(() => { expect(screen.getByText('Official registry')).toBeDefined() })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  // The contrast is the point: an official source and a third-party one must read differently.
  it('badges the official source and a third-party one differently', async () => {
    mockApi([OFFICIAL, THIRD_PARTY])
    renderSources()

    await waitFor(() => { expect(screen.getByText('Official registry')).toBeDefined() })
    expect(within(screen.getByTestId('source-1')).getByText('Official')).toBeDefined()
    expect(within(screen.getByTestId('source-2')).getByText('Third-party')).toBeDefined()
  })

  it('badges a disabled source as disabled rather than by its trust level', async () => {
    mockApi([DISABLED])
    renderSources()

    await waitFor(() => { expect(screen.getByText('Old one')).toBeDefined() })
    expect(within(screen.getByTestId('source-3')).getByText('Disabled')).toBeDefined()
    expect(within(screen.getByTestId('source-3')).queryByText('Third-party')).toBeNull()
  })

  it('adds a source with the fixed github driver and the typed fields', async () => {
    const { calls } = mockApi([])
    renderSources()

    await waitFor(() => { expect(screen.getByLabelText('Name')).toBeDefined() })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Mirror' } })
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'https://github.com/a/b' } })
    fireEvent.change(screen.getByLabelText('Token'), { target: { value: 'a-token' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add a source' }))

    await waitFor(() => { expect(calls.some((c) => c.method === 'POST')).toBe(true) })
    const post = calls.find((c) => c.method === 'POST')
    expect(post?.body).toEqual({ label: 'Mirror', driver: 'github', location: 'https://github.com/a/b', token: 'a-token' })
  })

  it('omits the token from the add request when none was typed', async () => {
    const { calls } = mockApi([])
    renderSources()

    await waitFor(() => { expect(screen.getByLabelText('Name')).toBeDefined() })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Mirror' } })
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'https://github.com/a/b' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add a source' }))

    await waitFor(() => { expect(calls.some((c) => c.method === 'POST')).toBe(true) })
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      label: 'Mirror', driver: 'github', location: 'https://github.com/a/b',
    })
  })

  // The mask round trip (context ruling 5): submitting untouched must not overwrite the
  // stored credential, and the chosen shape is sending the mask back verbatim — sources.ts
  // skips a value equal to it.
  it('sends the stored mask back unchanged when the token field is left untouched', async () => {
    const { calls } = mockApi([THIRD_PARTY])
    renderSources()

    const row = await screen.findByTestId('source-2')
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }))

    await waitFor(() => { expect(calls.some((c) => c.method === 'PATCH')).toBe(true) })
    expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({ token: '••••' })
  })

  it('sends the typed token when the field is changed', async () => {
    const { calls } = mockApi([THIRD_PARTY])
    renderSources()

    const row = await screen.findByTestId('source-2')
    fireEvent.change(within(row).getByLabelText(/Token/), { target: { value: 'brand-new-token' } })
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }))

    await waitFor(() => { expect(calls.some((c) => c.method === 'PATCH')).toBe(true) })
    expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({ token: 'brand-new-token' })
  })

  // brief item 6: a typed PAT must not stay legible in the DOM, and must be re-synced to
  // the mask the PATCH answers with rather than echoing back what was typed.
  it('masks the token field and re-syncs it to the stored mask after saving', async () => {
    globalThis.fetch = mock((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === '/api/sources') return Promise.resolve(json([THIRD_PARTY]))
      if (method === 'PATCH') return Promise.resolve(json({ ...THIRD_PARTY, token: '••••' }))
      return Promise.resolve(json({ error: { message: 'unhandled in test' } }, 404))
    }) as unknown as typeof fetch
    renderSources()

    const row = await screen.findByTestId('source-2')
    const tokenInput = within(row).getByLabelText(/Token/)
    fireEvent.change(tokenInput, { target: { value: 'brand-new-token' } })
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }))

    await waitFor(() => { expect((tokenInput as HTMLInputElement).value).toBe('••••') })
    expect(tokenInput).toHaveProperty('type', 'password')
  })
})
