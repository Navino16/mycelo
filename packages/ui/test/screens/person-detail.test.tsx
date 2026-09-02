import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { MemoryRouter, Route, Routes } from 'react-router'
import { I18nProvider } from '../../src/i18n.tsx'
import { PersonDetail } from '../../src/screens/PersonDetail.tsx'
import type { PersonDto, RoleDto } from '../../src/api/types.ts'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

const ROLES: readonly RoleDto[] = [
  { name: 'owner', builtin: true, patterns: ['*'] },
  { name: 'guest', builtin: false, patterns: ['help.help'] },
  { name: 'family', builtin: false, patterns: ['radarr.*'] },
]

const UNREVIEWED: PersonDto = {
  id: 'zelda-1',
  displayName: 'Zelda',
  roles: ['guest'],
  identities: [
    { channel: 'console', externalId: 'zelda-99' },
    { channel: 'signal', externalId: '+15551234', displayName: 'Zelda S.' },
  ],
  reviewed: false,
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

interface Call { method: string, url: string, body: unknown }

/** A stateful fake serving what PersonDetail.tsx calls, tracking every call it saw. */
function mockApi(
  options: {
    person?: PersonDto
    roles?: readonly RoleDto[]
    patchStatus?: number
    patchBody?: unknown
    postStatus?: number
    postBody?: unknown
    fail?: boolean
  } = {},
): { calls: Call[] } {
  const calls: Call[] = []
  let person = options.person ?? UNREVIEWED
  const roles = options.roles ?? ROLES

  globalThis.fetch = mock((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ method, url, body })

    if (options.fail === true) return Promise.resolve(json({ error: { message: 'x' } }, 500))

    if (method === 'GET' && url === `/api/people/${person.id}`) return Promise.resolve(json(person))
    if (method === 'GET' && url === '/api/roles') return Promise.resolve(json(roles))

    if (method === 'PATCH' && url === `/api/people/${person.id}`) {
      if (options.patchStatus !== undefined) {
        return Promise.resolve(json(options.patchBody ?? { error: { message: 'refused' } }, options.patchStatus))
      }
      person = { ...person, ...(body as Partial<PersonDto>) }
      return Promise.resolve(json(person))
    }

    const post = new RegExp(`^/api/people/${person.id}/roles$`).exec(url)
    if (method === 'POST' && post !== null) {
      if (options.postStatus !== undefined) {
        return Promise.resolve(json(options.postBody ?? { error: { message: 'refused' } }, options.postStatus))
      }
      const added = (body as { role: string }).role
      person = { ...person, roles: [...person.roles, added] }
      return Promise.resolve(json({ ok: true }))
    }

    const del = new RegExp(`^/api/people/${person.id}/roles/([^/]+)$`).exec(url)
    if (method === 'DELETE' && del !== null) {
      person = { ...person, roles: person.roles.filter((r) => r !== del[1]) }
      return Promise.resolve(json({ ok: true }))
    }

    return Promise.resolve(json({ error: { message: 'unhandled in test' } }, 404))
  }) as unknown as typeof fetch
  return { calls }
}

function renderDetail(id = 'zelda-1'): void {
  render(
    <I18nProvider>
      <MemoryRouter initialEntries={[`/people/${id}`]}>
        <Routes><Route path="/people/:id" element={<PersonDetail />} /></Routes>
      </MemoryRouter>
    </I18nProvider>,
  )
}

describe('a person', () => {
  it('says something went wrong when the fetch fails, rather than staying blank', async () => {
    mockApi({ fail: true })
    renderDetail()

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Something went wrong')
  })

  it('renders identities and roles on success, with no error banner', async () => {
    mockApi()
    renderDetail()

    await waitFor(() => { expect(screen.getByText('Zelda')).toBeDefined() })
    expect(screen.getByText('zelda-99')).toBeDefined()
    expect(screen.getByText('+15551234')).toBeDefined()
    expect(screen.getByText('Zelda S.')).toBeDefined()
    expect(screen.getByText('guest')).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('offers "mark as reviewed" while unreviewed, and removes it once reviewed', async () => {
    mockApi({ person: { ...UNREVIEWED, reviewed: false } })
    renderDetail()

    await waitFor(() => { expect(screen.getByText('Zelda')).toBeDefined() })
    expect(screen.getByRole('button', { name: 'Mark as reviewed' })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Mark as reviewed' }))

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Mark as reviewed' })).toBeNull()
    })
  })

  it('does not offer "mark as reviewed" for an already-reviewed person', async () => {
    mockApi({ person: { ...UNREVIEWED, reviewed: true } })
    renderDetail()

    await waitFor(() => { expect(screen.getByText('Zelda')).toBeDefined() })
    expect(screen.queryByRole('button', { name: 'Mark as reviewed' })).toBeNull()
  })

  it('adds a role through the picker, then lists it', async () => {
    const { calls } = mockApi()
    renderDetail()

    await waitFor(() => { expect(screen.getByText('Zelda')).toBeDefined() })
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'family' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add a role' }))

    await waitFor(() => { expect(calls.some((c) => c.method === 'POST')).toBe(true) })
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ role: 'family' })
    await waitFor(() => { expect(screen.getByText('family')).toBeDefined() })
  })

  // Discriminates the `roleToAdd === ''` guard: submitting the picker at its default, empty
  // option must not send a role-less POST.
  it('does not send a role when the picker is submitted at its blank default', async () => {
    const { calls } = mockApi()
    renderDetail()

    await waitFor(() => { expect(screen.getByText('Zelda')).toBeDefined() })
    fireEvent.click(screen.getByRole('button', { name: 'Add a role' }))

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('removes a held role', async () => {
    const { calls } = mockApi()
    renderDetail()

    await waitFor(() => { expect(screen.getByText('guest')).toBeDefined() })
    fireEvent.click(screen.getByRole('button', { name: 'Remove guest' }))

    await waitFor(() => { expect(calls.some((c) => c.method === 'DELETE')).toBe(true) })
    // Not queryByText('guest'): once removed, 'guest' reappears as an option in the add-role
    // picker, so the held-role pill is what must be gone, not the word on the whole page.
    await waitFor(() => { expect(screen.queryByRole('button', { name: 'Remove guest' })).toBeNull() })
  })

  it('edits the display name through PATCH', async () => {
    const { calls } = mockApi()
    renderDetail()

    await waitFor(() => { expect(screen.getByDisplayValue('Zelda')).toBeDefined() })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Zelda Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => { expect(calls.some((c) => c.method === 'PATCH')).toBe(true) })
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ displayName: 'Zelda Renamed' })
  })
})
