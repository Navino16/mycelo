import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { MemoryRouter } from 'react-router'
import { I18nProvider } from '../../src/i18n.tsx'
import { People } from '../../src/screens/People.tsx'
import type { PersonDto, RoleDto } from '../../src/api/types.ts'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

const ROLES: readonly RoleDto[] = [
  { name: 'owner', builtin: true, patterns: ['*'] },
  { name: 'guest', builtin: false, patterns: ['help.help'] },
]

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function build(count: number, offset = 0): PersonDto[] {
  return Array.from({ length: count }, (_, i) => {
    const n = offset + i + 1
    return {
      id: `person-${String(n)}`,
      displayName: `Person ${String(n)}`,
      roles: [],
      identities: [{ channel: 'console', externalId: `ext-${String(n)}` }],
      reviewed: false,
    }
  })
}

interface Call { method: string, url: string, body: unknown }

/** A stateful fake serving what People.tsx calls, tracking every call it saw. */
function mockApi(options: {
  people?: readonly PersonDto[]
  perPage?: number
  roles?: readonly RoleDto[]
  postOutcomes?: Record<string, number>
  fail?: boolean
} = {}): { calls: Call[] } {
  const calls: Call[] = []
  const people = options.people ?? build(3)
  const perPage = options.perPage ?? 50
  const roles = options.roles ?? ROLES

  globalThis.fetch = mock((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ method, url, body })

    if (options.fail === true) return Promise.resolve(json({ error: { message: 'x' } }, 500))

    if (method === 'GET' && url.startsWith('/api/people?')) {
      const params = new URLSearchParams(url.split('?')[1])
      const page = Number(params.get('page') ?? '1')
      const q = params.get('q')
      const reviewed = params.get('reviewed')
      let filtered = people
      if (q !== null && q !== '') {
        const needle = q.toLowerCase()
        filtered = filtered.filter((p) => (p.displayName ?? '').toLowerCase().includes(needle))
      }
      if (reviewed === 'false') filtered = filtered.filter((p) => !p.reviewed)
      const total = filtered.length
      const start = (page - 1) * perPage
      const items = filtered.slice(start, start + perPage)
      return Promise.resolve(json({ items, page, perPage, total }))
    }

    if (method === 'GET' && url === '/api/roles') return Promise.resolve(json(roles))

    const post = /^\/api\/people\/([^/]+)\/roles$/.exec(url)
    if (method === 'POST' && post !== null) {
      const status = options.postOutcomes?.[post[1] as string] ?? 200
      if (status !== 200) return Promise.resolve(json({ error: { message: 'refused' } }, status))
      return Promise.resolve(json({ ok: true }))
    }

    return Promise.resolve(json({ error: { message: 'unhandled in test' } }, 404))
  }) as unknown as typeof fetch
  return { calls }
}

function renderPeople(): void {
  render(<I18nProvider><MemoryRouter><People /></MemoryRouter></I18nProvider>)
}

describe('the people list', () => {
  it('says something went wrong when the fetch fails, rather than staying blank', async () => {
    mockApi({ fail: true })
    renderPeople()

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Something went wrong')
  })

  it('renders the list on success, with no error banner', async () => {
    mockApi({ people: build(3) })
    renderPeople()

    await waitFor(() => { expect(screen.getByText('Person 1')).toBeDefined() })
    expect(screen.getByText('Person 2')).toBeDefined()
    expect(screen.getByText('Person 3')).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('debounces the search box: rapid typing produces exactly one query request', async () => {
    const { calls } = mockApi({ people: build(3) })
    renderPeople()

    await waitFor(() => { expect(screen.getByText('Person 1')).toBeDefined() })
    calls.length = 0

    const input = screen.getByLabelText('Search')
    fireEvent.change(input, { target: { value: 'a' } })
    fireEvent.change(input, { target: { value: 'al' } })
    fireEvent.change(input, { target: { value: 'ali' } })

    await act(() => new Promise((resolve) => setTimeout(resolve, 350)))

    const queried = calls.filter((c) => c.method === 'GET' && c.url.includes('q='))
    expect(queried).toHaveLength(1)
    expect(queried[0]?.url).toContain('q=ali')
  })

  it('sends reviewed=false, and only that, when the never-reviewed filter is checked', async () => {
    const { calls } = mockApi({ people: build(2) })
    renderPeople()

    await waitFor(() => { expect(screen.getByText('Person 1')).toBeDefined() })
    fireEvent.click(screen.getByLabelText('Never reviewed'))

    await waitFor(() => {
      expect(calls.some((c) => c.method === 'GET' && c.url.includes('reviewed=false'))).toBe(true)
    })
  })

  it('bulk-assigns a role and reports how many of how many succeeded, not a plain success', async () => {
    const people = build(3)
    const { calls } = mockApi({
      people,
      postOutcomes: { 'person-2': 500 },
    })
    renderPeople()

    await waitFor(() => { expect(screen.getByText('Person 1')).toBeDefined() })
    fireEvent.click(screen.getByLabelText('Person 1'))
    fireEvent.click(screen.getByLabelText('Person 2'))
    fireEvent.click(screen.getByLabelText('Person 3'))
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'guest' } })
    fireEvent.click(screen.getByRole('button', { name: 'Assign a role' }))

    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'POST').length).toBe(3)
    })
    expect(await screen.findByText(/2 of 3 assigned/)).toBeDefined()
  })
})

describe('the people list at scale', () => {
  it('paginates 80 rows across two pages, deriving pages from the response, not a guess', async () => {
    const people = build(80)
    mockApi({ people, perPage: 50 })
    renderPeople()

    await waitFor(() => { expect(screen.getByText('Person 1')).toBeDefined() })
    expect(screen.getByText('Person 50')).toBeDefined()
    expect(screen.queryByText('Person 51')).toBeNull()
    expect(screen.getByText('Page 1 / 2')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Previous' })).toHaveProperty('disabled', true)

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    await waitFor(() => { expect(screen.getByText('Person 51')).toBeDefined() })
    expect(screen.getByText('Person 80')).toBeDefined()
    expect(screen.queryByText('Person 1')).toBeNull()
    expect(screen.getByText('Page 2 / 2')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Next' })).toHaveProperty('disabled', true)
  })
})
