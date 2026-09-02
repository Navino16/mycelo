import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { MemoryRouter } from 'react-router'
import { I18nProvider } from '../../src/i18n.tsx'
import { Roles } from '../../src/screens/Roles.tsx'
import type { ConfigDto, RoleDto } from '../../src/api/types.ts'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

const CONFIG: ConfigDto = { prefix: '/', defaultLocale: 'en', defaultRole: 'guest' }

const ROLES: readonly RoleDto[] = [
  { name: 'owner', builtin: true, patterns: ['*'] },
  { name: 'guest', builtin: false, patterns: ['help.help'] },
  { name: 'family', builtin: false, patterns: ['radarr.*'] },
]

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

interface Call { method: string, url: string, body: unknown }

/** A stateful fake serving what Roles.tsx calls, tracking every call it saw. */
function mockApi(
  options: { roles?: readonly RoleDto[], config?: ConfigDto, postStatus?: number, postBody?: unknown, deleteStatus?: number, deleteBody?: unknown } = {},
): { calls: Call[] } {
  const calls: Call[] = []
  let roles = [...(options.roles ?? ROLES)]
  const config = options.config ?? CONFIG

  globalThis.fetch = mock((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ method, url, body })

    if (method === 'GET' && url === '/api/roles') return Promise.resolve(json(roles))
    if (method === 'GET' && url === '/api/config') return Promise.resolve(json(config))

    if (method === 'POST' && url === '/api/roles') {
      if (options.postStatus !== undefined) {
        return Promise.resolve(json(options.postBody ?? { error: { message: 'refused' } }, options.postStatus))
      }
      const created = body as { name: string }
      roles = [...roles, { name: created.name, builtin: false, patterns: [] }]
      return Promise.resolve(json({ ok: true }))
    }

    const del = /^\/api\/roles\/([^/]+)$/.exec(url)
    if (method === 'DELETE' && del !== null) {
      if (options.deleteStatus !== undefined) {
        return Promise.resolve(json(options.deleteBody ?? { error: { message: 'refused' } }, options.deleteStatus))
      }
      roles = roles.filter((r) => r.name !== del[1])
      return Promise.resolve(json({ ok: true }))
    }

    return Promise.resolve(json({ error: { message: 'unhandled in test' } }, 404))
  }) as unknown as typeof fetch
  return { calls }
}

function renderRoles(): void {
  render(<I18nProvider><MemoryRouter><Roles /></MemoryRouter></I18nProvider>)
}

describe('the roles list', () => {
  it('says something went wrong when the fetch fails, rather than staying blank', async () => {
    globalThis.fetch = mock(() => Promise.resolve(json({ error: { message: 'x' } }, 500)))
    renderRoles()

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Something went wrong')
  })

  it('renders the list on success, with no error banner', async () => {
    mockApi()
    renderRoles()

    await waitFor(() => { expect(screen.getByText('owner')).toBeDefined() })
    expect(screen.getByText('guest')).toBeDefined()
    expect(screen.getByText('family')).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  // The default role does the real work (brief §7C) and must be visible, not buried.
  it('marks the row matching GET /api/config defaultRole, and only that row', async () => {
    mockApi()
    renderRoles()

    await waitFor(() => { expect(screen.getByText('guest')).toBeDefined() })
    expect(screen.getByText('Default role')).toBeDefined()
    expect(screen.getByText('What an unknown sender gets on first contact.')).toBeDefined()

    // Marked on guest's own row, not on family's or owner's.
    const familyRow = screen.getByText('family').closest('li')
    expect(familyRow).not.toBeNull()
    expect(familyRow?.textContent).not.toContain('Default role')
    const ownerRow = screen.getByText('owner').closest('li')
    expect(ownerRow?.textContent).not.toContain('Default role')
  })

  it('marks a built-in role, and does not mark an ordinary one', async () => {
    mockApi()
    renderRoles()

    await waitFor(() => { expect(screen.getByText('owner')).toBeDefined() })
    const ownerRow = screen.getByText('owner').closest('li')
    expect(ownerRow?.textContent).toContain('Built in')

    const familyRow = screen.getByText('family').closest('li')
    expect(familyRow?.textContent).not.toContain('Built in')
  })

  // Neither the default role nor a built-in one may be deleted from this screen; an
  // ordinary role is the positive control proving delete is offered at all.
  it('offers delete on an ordinary role, but neither on the default nor on a built-in one', async () => {
    mockApi()
    renderRoles()

    await waitFor(() => { expect(screen.getByText('family')).toBeDefined() })

    const familyRow = screen.getByText('family').closest('li')
    expect(familyRow).not.toBeNull()
    expect(familyRow !== null && within(familyRow).queryByRole('button', { name: 'Delete' })).not.toBeNull()

    const guestRow = screen.getByText('guest').closest('li')
    expect(guestRow !== null && within(guestRow).queryByRole('button', { name: 'Delete' })).toBeNull()

    const ownerRow = screen.getByText('owner').closest('li')
    expect(ownerRow !== null && within(ownerRow).queryByRole('button', { name: 'Delete' })).toBeNull()
  })

  it('deletes an ordinary role and removes it from the list', async () => {
    const { calls } = mockApi()
    renderRoles()

    await waitFor(() => { expect(screen.getByText('family')).toBeDefined() })
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => { expect(calls.some((c) => c.method === 'DELETE')).toBe(true) })
    await waitFor(() => { expect(screen.queryByText('family')).toBeNull() })
  })

  it('renders the delete refusal in its own alert', async () => {
    mockApi({ deleteStatus: 400, deleteBody: { error: { message: 'a built-in role cannot be changed' } } })
    renderRoles()

    await waitFor(() => { expect(screen.getByText('family')).toBeDefined() })
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'a built-in role cannot be changed')
  })

  it('creates a role with the name typed, then lists it', async () => {
    const { calls } = mockApi()
    renderRoles()

    await waitFor(() => { expect(screen.getByText('owner')).toBeDefined() })
    fireEvent.change(screen.getByLabelText('New role'), { target: { value: 'media' } })
    fireEvent.click(screen.getByRole('button', { name: 'New role' }))

    await waitFor(() => { expect(calls.some((c) => c.method === 'POST')).toBe(true) })
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ name: 'media' })
    await waitFor(() => { expect(screen.getByText('media')).toBeDefined() })
  })

  it('renders the create refusal in its own alert: an existing name is refused', async () => {
    mockApi({ postStatus: 409, postBody: { error: { message: 'a role named guest already exists' } } })
    renderRoles()

    await waitFor(() => { expect(screen.getByLabelText('New role')).toBeDefined() })
    fireEvent.change(screen.getByLabelText('New role'), { target: { value: 'guest' } })
    fireEvent.click(screen.getByRole('button', { name: 'New role' }))

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'a role named guest already exists')
  })
})

// brief §3: 5-10 roles, never three sample rows. build() fills the real order of magnitude so a
// role dropped from the list, or the default marker misapplied, turns a specific assertion red.
function build(count: number): RoleDto[] {
  return Array.from({ length: count }, (_, i) => ({ name: `role-${String(i + 1)}`, builtin: false, patterns: [] }))
}

describe('the roles list at scale', () => {
  it('lists every role at once, with delete offered on each ordinary one', async () => {
    const roles = [{ name: 'owner', builtin: true, patterns: ['*'] }, ...build(8)]
    mockApi({ roles, config: { prefix: '/', defaultLocale: 'en', defaultRole: 'role-3' } })
    renderRoles()

    await waitFor(() => { expect(screen.getByText('owner')).toBeDefined() })
    for (const role of roles) expect(screen.getByText(role.name)).toBeDefined()

    // 9 roles total: 8 ordinary minus the one marked default, none for the built-in owner.
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(7)
    expect(screen.getByText('role-3').closest('li')?.textContent).toContain('Default role')
  })
})
