import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { MemoryRouter } from 'react-router'
import { I18nProvider } from '../../src/i18n.tsx'
import { Roles } from '../../src/screens/Roles.tsx'
import type { CommandDto, CommandGroups, ConfigDto, RoleDto } from '../../src/api/types.ts'

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

function command(plugin: string, name: string): CommandDto {
  return {
    plugin, command: name, declared: name, qualified: `${plugin}.${name}`,
    description: `${plugin} ${name}`, capabilities: [],
  }
}

/** Four commands over two plugins: 'radarr.*' grants two of them, 'help.help' exactly one. */
const COMMANDS: CommandGroups = {
  radarr: [command('radarr', 'search'), command('radarr', 'add')],
  help: [command('help', 'help'), command('help', 'about')],
}

/** A stateful fake serving what Roles.tsx calls, tracking every call it saw. */
function mockApi(
  options: {
    roles?: readonly RoleDto[]
    config?: ConfigDto
    configStatus?: number
    postStatus?: number
    postBody?: unknown
    deleteStatus?: number
    deleteBody?: unknown
    commands?: CommandGroups
    commandsStatus?: number
    holders?: Readonly<Record<string, number>>
    holdersStatus?: number
    people?: number
  } = {},
): { calls: Call[] } {
  const calls: Call[] = []
  let roles = [...(options.roles ?? ROLES)]
  const config = options.config ?? CONFIG

  globalThis.fetch = mock((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ method, url, body })

    if (method === 'GET' && url === '/api/roles') return Promise.resolve(json(roles))
    if (method === 'GET' && url === '/api/config') {
      if (options.configStatus !== undefined) {
        return Promise.resolve(json({ error: { message: 'refused' } }, options.configStatus))
      }
      return Promise.resolve(json(config))
    }
    if (method === 'GET' && url === '/api/commands') {
      if (options.commandsStatus !== undefined) {
        return Promise.resolve(json({ error: { message: 'refused' } }, options.commandsStatus))
      }
      return Promise.resolve(json(options.commands ?? COMMANDS))
    }
    if (method === 'GET' && url === '/api/people?perPage=1') {
      return Promise.resolve(json({ items: [], page: 1, perPage: 1, total: options.people ?? 0 }))
    }
    const holder = /^\/api\/people\?role=([^&]+)&perPage=1$/.exec(url)
    if (method === 'GET' && holder !== null) {
      if (options.holdersStatus !== undefined) {
        return Promise.resolve(json({ error: { message: 'refused' } }, options.holdersStatus))
      }
      const role = decodeURIComponent(holder[1] ?? '')
      return Promise.resolve(json({ items: [], page: 1, perPage: 1, total: options.holders?.[role] ?? 0 }))
    }

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

/** The row for one role, so the default role's name in the accent card is never mistaken for it. */
function row(name: string): HTMLElement {
  return screen.getByTestId(`role-${name}`)
}

describe('the roles list', () => {
  it('says something went wrong when the fetch fails, rather than staying blank', async () => {
    globalThis.fetch = mock(() => Promise.resolve(json({ error: { message: 'x' } }, 500)))
    renderRoles()

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Something went wrong')
  })

  // I2: a refused /api/config costs the default-role card, never the table — the comment four
  // lines above the holder counts already reasoned that no single refusal may blank the screen.
  it('keeps the roles table when /api/config is refused, losing only the default card', async () => {
    mockApi({ configStatus: 500 })
    renderRoles()

    await waitFor(() => { expect(row('guest')).toBeDefined() })
    expect(row('owner')).toBeDefined()
    expect(screen.queryByText('Default role · what unknown senders get')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('renders the list on success, with no error banner', async () => {
    mockApi()
    renderRoles()

    expect(await screen.findByTestId('role-owner')).toBeDefined()
    expect(row('guest')).toBeDefined()
    expect(row('family')).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  // The default role does the real work (brief §7C) and must be visible, not buried.
  it('marks the row matching GET /api/config defaultRole, and only that row', async () => {
    mockApi()
    renderRoles()

    expect(await screen.findByTestId('role-guest')).toBeDefined()
    expect(screen.getByText('Default role')).toBeDefined()
    expect(screen.getByText('What an unknown sender gets on first contact.')).toBeDefined()

    // Marked on guest's own row, not on family's or owner's.
    expect(row('family').textContent).not.toContain('Default role')
    expect(row('owner').textContent).not.toContain('Default role')
  })

  it('marks a built-in role, and does not mark an ordinary one', async () => {
    mockApi()
    renderRoles()

    expect((await screen.findByTestId('role-owner')).textContent).toContain('Built in')
    expect(row('family').textContent).not.toContain('Built in')
  })

  // Neither the default role nor a built-in one may be deleted from this screen; an
  // ordinary role is the positive control proving delete is offered at all.
  it('offers delete on an ordinary role, but neither on the default nor on a built-in one', async () => {
    mockApi()
    renderRoles()

    expect(within(await screen.findByTestId('role-family')).queryByRole('button', { name: 'Delete' })).not.toBeNull()
    expect(within(row('guest')).queryByRole('button', { name: 'Delete' })).toBeNull()
    expect(within(row('owner')).queryByRole('button', { name: 'Delete' })).toBeNull()
  })

  it('deletes an ordinary role and removes it from the list', async () => {
    const { calls } = mockApi()
    renderRoles()

    expect(await screen.findByTestId('role-family')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => { expect(calls.some((c) => c.method === 'DELETE')).toBe(true) })
    await waitFor(() => { expect(screen.queryByTestId('role-family')).toBeNull() })
  })

  it('renders the delete refusal in its own alert', async () => {
    mockApi({ deleteStatus: 400, deleteBody: { error: { message: 'a built-in role cannot be changed' } } })
    renderRoles()

    expect(await screen.findByTestId('role-family')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'a built-in role cannot be changed')
  })

  it('creates a role with the name typed, then lists it', async () => {
    const { calls } = mockApi()
    renderRoles()

    expect(await screen.findByTestId('role-owner')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'New role' }))
    fireEvent.change(screen.getByLabelText('New role'), { target: { value: 'media' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => { expect(calls.some((c) => c.method === 'POST')).toBe(true) })
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ name: 'media' })
    await waitFor(() => { expect(screen.getByTestId('role-media')).toBeDefined() })
  })

  it('renders the create refusal in its own alert: an existing name is refused', async () => {
    mockApi({ postStatus: 409, postBody: { error: { message: 'a role named guest already exists' } } })
    renderRoles()

    fireEvent.click(await screen.findByRole('button', { name: 'New role' }))
    fireEvent.change(screen.getByLabelText('New role'), { target: { value: 'guest' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'a role named guest already exists')
  })
})

describe('what each row states about a role', () => {
  // task 14's ?role= filter, rendered. A count read off the unfiltered total would show the
  // whole substrate's population beside every role, which is the failure this catches.
  it('shows a different holder count per role, not the same total twice', async () => {
    mockApi({ holders: { family: 9, guest: 98, owner: 1 }, people: 128 })
    renderRoles()

    expect(await screen.findByText('9 people')).toBeDefined()
    expect(screen.getByText('98 people')).toBeDefined()
    expect(within(row('family')).getByText('9 people')).toBeDefined()
    expect(within(row('guest')).getByText('98 people')).toBeDefined()
  })

  it('says one person, not 1 people, for a role a single person holds', async () => {
    mockApi({ holders: { owner: 1 }, people: 128 })
    renderRoles()

    expect(within(await screen.findByTestId('role-owner')).getByText('1 person')).toBeDefined()
  })

  // 'all 4 commands' is what a wildcard means; '1 of 4' is what an explicit pattern means.
  // Reading one off the other is the join through patterns.ts this pins.
  it('states the commands each role reaches, counted against the whole registry', async () => {
    mockApi()
    renderRoles()

    expect(within(await screen.findByTestId('role-owner')).getByText('all 4 commands')).toBeDefined()
    expect(within(row('guest')).getByText('1 of 4')).toBeDefined()
    expect(within(row('family')).getByText('2 of 4')).toBeDefined()
  })

  it('lists the wildcards a role holds, and an em dash for a role holding none', async () => {
    mockApi()
    renderRoles()

    expect(within(await screen.findByTestId('role-family')).getByText('radarr.*')).toBeDefined()
    expect(within(row('owner')).getByText('*')).toBeDefined()
    expect(within(row('guest')).getByText('—')).toBeDefined()
  })

  it('summarises the substrate above the table', async () => {
    mockApi({ holders: { family: 9, guest: 98, owner: 1 }, people: 128 })
    renderRoles()

    expect(await screen.findByText('3 roles · 128 people · 4 commands')).toBeDefined()
  })
})

// A count nobody confirmed is withheld, never rendered as 0: a screen claiming `0 commands`
// or `held by 0 of 128 people` states something about the substrate that no route answered.
describe('a count still in flight, or refused', () => {
  it('shows no 0 commands in the summary when /api/commands is refused', async () => {
    mockApi({ commandsStatus: 500, holders: { guest: 98 }, people: 128 })
    renderRoles()

    expect(await screen.findByTestId('role-guest')).toBeDefined()
    expect(screen.queryByText('3 roles · 128 people · 0 commands')).toBeNull()
    expect(screen.queryByText('0 of 4')).toBeNull()
  })

  it('shows no held by 0 in the default card until that role’s own count answers', async () => {
    mockApi({ holdersStatus: 500, people: 128 })
    renderRoles()

    // The card itself still renders: only the sentence it cannot yet state is withheld.
    expect(await screen.findByText('Default role · what unknown senders get')).toBeDefined()
    expect(screen.getByRole('link', { name: 'Edit guest' })).toBeDefined()
    expect(screen.queryByText('1 of 4 commands · held by 0 of 128 people')).toBeNull()
  })

  it('shows no 0 people in a row whose count was refused', async () => {
    mockApi({ holdersStatus: 500, people: 128 })
    renderRoles()

    expect(within(await screen.findByTestId('role-guest')).queryByText('0 people')).toBeNull()
  })
})

describe('the default-role card', () => {
  it('names the default role, what it reaches and who holds it, and states it is read-only', async () => {
    mockApi({ holders: { guest: 98 }, people: 128 })
    renderRoles()

    expect(await screen.findByText('Default role · what unknown senders get')).toBeDefined()
    expect(screen.getByText('1 of 4 commands · held by 98 of 128 people')).toBeDefined()
    expect(screen.getByText('The default role is set in mycelo.yaml and cannot be changed from here.')).toBeDefined()
    expect(screen.getByRole('link', { name: 'Edit guest' })).toBeDefined()
  })

  // A substrate whose mycelo.yaml names no default role has no card, and the table alone
  // must still render: a card keyed on `undefined` would match every role or none.
  it('renders no card when mycelo.yaml declares no default role', async () => {
    mockApi({ config: { prefix: '/', defaultLocale: 'en' } })
    renderRoles()

    expect(await screen.findByTestId('role-guest')).toBeDefined()
    expect(screen.queryByText('Default role · what unknown senders get')).toBeNull()
    expect(screen.queryByText('Default role')).toBeNull()
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

    expect(await screen.findByTestId('role-owner')).toBeDefined()
    for (const role of roles) expect(row(role.name)).toBeDefined()

    // 9 roles total: 8 ordinary minus the one marked default, none for the built-in owner.
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(7)
    expect(row('role-3').textContent).toContain('Default role')
  })
})
