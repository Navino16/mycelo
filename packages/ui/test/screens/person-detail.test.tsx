import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { MemoryRouter, Route, Routes } from 'react-router'
import { I18nProvider } from '../../src/i18n.tsx'
import { PersonDetail } from '../../src/screens/PersonDetail.tsx'
import type { CommandGroups, ConfigDto, PersonDto, RoleDto } from '../../src/api/types.ts'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

const ROLES: readonly RoleDto[] = [
  { name: 'owner', builtin: true, patterns: ['*'] },
  { name: 'guest', builtin: false, patterns: ['help.help'] },
  { name: 'family', builtin: false, patterns: ['radarr.*'] },
]

/** Four commands over three plugins: 'family' reaches two of them, 'guest' exactly one. */
const COMMANDS: CommandGroups = {
  radarr: [
    { plugin: 'radarr', command: 'search', declared: 'search', qualified: 'radarr.search', description: 'a', capabilities: [] },
    { plugin: 'radarr', command: 'add', declared: 'add', qualified: 'radarr.add', description: 'b', capabilities: [] },
  ],
  help: [
    { plugin: 'help', command: 'help', declared: 'help', qualified: 'help.help', description: 'c', capabilities: [] },
  ],
  weather: [
    { plugin: 'weather', command: 'today', declared: 'today', qualified: 'weather.today', description: 'd', capabilities: [] },
  ],
}

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

/** The case a `roles[0]` join gets wrong: one wildcard role and one single-command role. */
const TWO_ROLES: PersonDto = { ...UNREVIEWED, roles: ['guest', 'family'], reviewed: true }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

interface Call { method: string, url: string, body: unknown }

/** A stateful fake serving what PersonDetail.tsx calls, tracking every call it saw. */
function mockApi(
  options: {
    person?: PersonDto
    roles?: readonly RoleDto[]
    commands?: CommandGroups
    config?: ConfigDto
    commandsFail?: boolean
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
  const config = options.config ?? { prefix: '!', defaultLocale: 'en', defaultRole: 'guest' }

  globalThis.fetch = mock((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ method, url, body })

    if (options.fail === true) return Promise.resolve(json({ error: { message: 'x' } }, 500))

    if (method === 'GET' && url === `/api/people/${person.id}`) return Promise.resolve(json(person))
    if (method === 'GET' && url === '/api/roles') return Promise.resolve(json(roles))
    if (method === 'GET' && url === '/api/config') return Promise.resolve(json(config))
    if (method === 'GET' && url === '/api/commands') {
      if (options.commandsFail === true) return Promise.resolve(json({ error: { message: 'x' } }, 500))
      return Promise.resolve(json(options.commands ?? COMMANDS))
    }

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

    expect(await screen.findByRole('heading', { level: 1, name: 'Zelda' })).toBeDefined()
    expect(screen.getByText('zelda-99')).toBeDefined()
    expect(screen.getByText('+15551234')).toBeDefined()
    expect(screen.getByText('Zelda S.')).toBeDefined()
    expect(screen.getByText('2 identities')).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('counts one identity in the singular', async () => {
    mockApi({ person: { ...UNREVIEWED, identities: [{ channel: 'signal', externalId: '+1' }] } })
    renderDetail()

    expect(await screen.findByText('1 identity')).toBeDefined()
  })

  it('says merging is manual, which no other surface says', async () => {
    mockApi()
    renderDetail()

    expect(await screen.findByText(/Merging identities is manual/)).toBeDefined()
  })

  it('offers "mark as reviewed" while unreviewed, and removes it once reviewed', async () => {
    mockApi({ person: { ...UNREVIEWED, reviewed: false } })
    renderDetail()

    const button = await screen.findByRole('button', { name: 'Mark as reviewed' })
    fireEvent.click(button)

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Mark as reviewed' })).toBeNull()
    })
  })

  it('does not offer "mark as reviewed" for an already-reviewed person', async () => {
    mockApi({ person: { ...UNREVIEWED, reviewed: true } })
    renderDetail()

    expect(await screen.findByRole('heading', { level: 1, name: 'Zelda' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Mark as reviewed' })).toBeNull()
  })

  it('adds a role through the picker, then lists it', async () => {
    const { calls } = mockApi()
    renderDetail()

    expect(await screen.findByRole('heading', { level: 1, name: 'Zelda' })).toBeDefined()
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'family' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add a role' }))

    await waitFor(() => { expect(calls.some((c) => c.method === 'POST')).toBe(true) })
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ role: 'family' })
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Remove family' })).toBeDefined() })
  })

  // Discriminates the `roleToAdd === ''` guard: submitting the picker at its default, empty
  // option must not send a role-less POST.
  it('does not send a role when the picker is submitted at its blank default', async () => {
    const { calls } = mockApi()
    renderDetail()

    expect(await screen.findByRole('heading', { level: 1, name: 'Zelda' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Add a role' }))

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('removes a held role', async () => {
    const { calls } = mockApi()
    renderDetail()

    fireEvent.click(await screen.findByRole('button', { name: 'Remove guest' }))

    await waitFor(() => { expect(calls.some((c) => c.method === 'DELETE')).toBe(true) })
    // Not queryByText('guest'): once removed, 'guest' reappears as an option in the add-role
    // picker, so the held-role pill is what must be gone, not the word on the whole page.
    await waitFor(() => { expect(screen.queryByRole('button', { name: 'Remove guest' })).toBeNull() })
  })

  it('edits the display name through PATCH', async () => {
    const { calls } = mockApi()
    renderDetail()

    expect(await screen.findByDisplayValue('Zelda')).toBeDefined()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Zelda Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => { expect(calls.some((c) => c.method === 'PATCH')).toBe(true) })
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ displayName: 'Zelda Renamed' })
  })
})

describe('the never-reviewed banner', () => {
  it('names the role the bot handed out by itself, from /api/config', async () => {
    mockApi({ person: { ...UNREVIEWED, reviewed: false } })
    renderDetail()

    const banner = await screen.findByTestId('never-reviewed')
    expect(within(banner).getByText(/was given guest automatically on first contact/)).toBeDefined()
    expect(within(banner).getByRole('button', { name: 'Mark as reviewed' })).toBeDefined()
    // 2i-desktop draws the header pill without a banner, 2i-mobile the banner without the
    // pill: the banner's own heading is the only 'Never reviewed' on the page.
    expect(screen.queryAllByText('Never reviewed')).toHaveLength(1)
  })

  // The banner's whole sentence is about defaultRole, so with none configured there is
  // nothing true left to say — but the action must survive its removal.
  it('is dropped when no default role is configured, keeping the action', async () => {
    mockApi({
      person: { ...UNREVIEWED, reviewed: false },
      config: { prefix: '!', defaultLocale: 'en' },
    })
    renderDetail()

    expect(await screen.findByRole('button', { name: 'Mark as reviewed' })).toBeDefined()
    expect(screen.queryByTestId('never-reviewed')).toBeNull()
  })

  it('is absent for a reviewed person', async () => {
    mockApi({ person: TWO_ROLES })
    renderDetail()

    expect(await screen.findByRole('heading', { level: 1, name: 'Zelda' })).toBeDefined()
    expect(screen.queryByTestId('never-reviewed')).toBeNull()
  })
})

describe('a person’s effective rights', () => {
  // The three-way join: person.roles → /api/roles patterns → /api/commands. Two roles at
  // once, one holding a wildcard and one a single command, is what a roles[0] join misreads.
  it('unions the commands of every role held, not just the first', async () => {
    mockApi({ person: TWO_ROLES })
    renderDetail()

    const rights = await screen.findByTestId('rights')
    expect(within(rights).getByText('May run 3 of 4 commands')).toBeDefined()
    expect(within(rights).getByText('radarr.search')).toBeDefined()
    expect(within(rights).getByText('radarr.add')).toBeDefined()
    expect(within(rights).getByText('help.help')).toBeDefined()
    expect(within(rights).queryByText('weather.today')).toBeNull()
  })

  it('names the wildcard those roles carry', async () => {
    mockApi({ person: TWO_ROLES })
    renderDetail()

    const rights = await screen.findByTestId('rights')
    expect(within(rights).getByText('Wildcard through their roles: radarr.*')).toBeDefined()
    expect(within(rights).queryByText(/No wildcard applies/)).toBeNull()
  })

  it('says no wildcard applies when the roles hold none', async () => {
    mockApi({ person: { ...UNREVIEWED, roles: ['guest'] } })
    renderDetail()

    const rights = await screen.findByTestId('rights')
    expect(within(rights).getByText('May run 1 of 4 commands')).toBeDefined()
    expect(within(rights).getByText('No wildcard applies to this person.')).toBeDefined()
  })

  // In the roles list's own order, not the person's: patternsOf walks /api/roles once.
  it('names both wildcards in the plural, deduplicated', async () => {
    mockApi({ person: { ...TWO_ROLES, roles: ['family', 'owner'] } })
    renderDetail()

    const rights = await screen.findByTestId('rights')
    expect(within(rights).getByText('Wildcards through their roles: *, radarr.*')).toBeDefined()
    expect(within(rights).getByText('May run 4 of 4 commands')).toBeDefined()
  })

  // A count nobody confirmed is withheld: '0 of 0 commands' would read as "may run nothing".
  it('is withheld entirely when the command registry is refused', async () => {
    mockApi({ person: TWO_ROLES, commandsFail: true })
    renderDetail()

    expect(await screen.findByRole('heading', { level: 1, name: 'Zelda' })).toBeDefined()
    expect(screen.queryByTestId('rights')).toBeNull()
  })
})
