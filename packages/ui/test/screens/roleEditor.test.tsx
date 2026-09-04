import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { MemoryRouter, Route, Routes } from 'react-router'
import { I18nProvider, useLocale } from '../../src/i18n.tsx'
import { PluginGroup, RoleEditor } from '../../src/screens/RoleEditor.tsx'
import type { CommandDto, CommandGroups, RoleDto } from '../../src/api/types.ts'

const COMMANDS: readonly CommandDto[] = [
  { plugin: 'radarr', command: 'add', declared: 'add', qualified: 'radarr.add', description: 'Add', capabilities: [] },
  { plugin: 'radarr', command: 'remove', declared: 'remove', qualified: 'radarr.remove', description: 'Remove', capabilities: [] },
]

function renderGroup(patterns: readonly string[]): void {
  render(
    <I18nProvider>
      <PluginGroup plugin="radarr" commands={COMMANDS} patterns={patterns} onToggle={() => undefined} />
    </I18nProvider>,
  )
}

/** Collapsed by default since 2g, so every per-command assertion opens the group first. */
function openGroup(): void {
  fireEvent.click(screen.getByText('radarr'))
}

describe('the plugin group at its edges', () => {
  // A group with nothing in it must not tick as fully granted: `0 / 0` beside a green tick
  // says every command is covered on a plugin that declares none.
  it('leaves a group with no command unticked', () => {
    render(
      <I18nProvider>
        <PluginGroup plugin="silent" commands={[]} patterns={[]} onToggle={() => undefined} />
      </I18nProvider>,
    )

    expect(screen.getByRole<HTMLInputElement>('checkbox').checked).toBe(false)
  })

  // The filter opens the group it matches: without it aria-expanded says expanded while the
  // rows stay hidden, and the operator's search finds nothing.
  it('opens a matching group on the filter alone, with no click', () => {
    render(
      <I18nProvider>
        <PluginGroup
          plugin="radarr"
          commands={COMMANDS}
          patterns={['radarr.*']}
          filter="remove"
          onToggle={() => undefined}
        />
      </I18nProvider>,
    )

    expect(screen.getByText('Granted by a wildcard, so it covers commands that are not installed yet.'))
      .toBeDefined()
  })
})

describe('the role editor', () => {
  // design §12: a wildcard drawn as every box ticked says something false about a role
  // that deliberately does not enumerate.
  it('renders a wildcard as a wildcard, with no per-command checkbox at all', () => {
    renderGroup(['radarr.*'])

    expect(screen.getByText('radarr.*')).toBeDefined()
    openGroup()
    expect(screen.queryByTestId('radarr.add')).toBeNull()
    expect(screen.getByText('Granted by a wildcard, so it covers commands that are not installed yet.')).toBeDefined()
  })

  it('ticks exactly the commands an explicit pattern names', () => {
    renderGroup(['radarr.add'])
    openGroup()

    const ticked = screen.getAllByTestId(/^radarr\./).filter((c) => (c as HTMLInputElement).checked)
    expect(ticked).toHaveLength(1)
  })

  // The counter is what makes 104 commands legible; asserting the plural is the point.
  it('counts the granted commands against the plugin total', () => {
    renderGroup(['radarr.add'])
    expect(screen.getByText('1 / 2')).toBeDefined()
  })

  // The silent case: a bare '*' must render every group as covered, never as ticks, and the
  // counter must not claim a false 'n / n' either.
  it('renders a bare star as a covered group, with no checkboxes at all', () => {
    render(
      <I18nProvider>
        <PluginGroup plugin="radarr" commands={COMMANDS} patterns={['*']} onToggle={() => undefined} />
      </I18nProvider>,
    )

    expect(screen.getByText('covered')).toBeDefined()
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.queryByText('2 / 2')).toBeNull()
  })

  it('renders a built-in group read-only: every checkbox disabled, the group box included', () => {
    render(
      <I18nProvider>
        <PluginGroup
          plugin="radarr" commands={COMMANDS} patterns={['radarr.add']} onToggle={() => undefined} readOnly
        />
      </I18nProvider>,
    )
    openGroup()

    for (const box of screen.getAllByRole('checkbox')) expect((box as HTMLInputElement).disabled).toBe(true)
  })

  it('reports the plugin the group checkbox grants, and the one it clears', () => {
    const seen: [string, boolean][] = []
    render(
      <I18nProvider>
        <PluginGroup
          plugin="radarr" commands={COMMANDS} patterns={[]} onToggle={() => undefined}
          onSetPlugin={(p, granted) => seen.push([p, granted])}
        />
      </I18nProvider>,
    )

    fireEvent.click(screen.getByLabelText('All radarr commands'))
    expect(seen).toEqual([['radarr', true]])
  })

  it('leaves the group checkbox disabled when no handler is given', () => {
    renderGroup(['radarr.add'])

    expect(screen.getByLabelText<HTMLInputElement>('All radarr commands').disabled).toBe(true)
  })

  // Discriminates `readOnly || onSetPlugin === undefined` from the second clause alone: a
  // built-in role is rendered WITH a handler by nothing today, so only this pins readOnly.
  it('disables the group checkbox for a read-only group even when a handler is supplied', () => {
    const seen: string[] = []
    render(
      <I18nProvider>
        <PluginGroup
          plugin="radarr" commands={COMMANDS} patterns={['radarr.add']} onToggle={() => undefined}
          onSetPlugin={(p) => seen.push(p)} readOnly
        />
      </I18nProvider>,
    )

    const box = screen.getByLabelText<HTMLInputElement>('All radarr commands')
    expect(box.disabled).toBe(true)
    fireEvent.click(box)
    expect(seen).toEqual([])
  })
})

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

interface Call { method: string, url: string, body: unknown, locale: string | null }

const ORDINARY: RoleDto = { name: 'family', builtin: false, patterns: ['radarr.add'] }
const BUILTIN: RoleDto = { name: 'owner', builtin: true, patterns: ['*'] }

/** A stateful fake serving what RoleEditor calls, tracking every call it saw. */
function mockApi(
  options: {
    commands?: CommandGroups
    role?: RoleDto
    putStatus?: number
    putBody?: unknown
    descriptions?: Record<string, string>
    commandsStatus?: number
    holders?: number
  } = {},
): { calls: Call[] } {
  const calls: Call[] = []
  const commands = options.commands ?? { radarr: COMMANDS }
  let role = options.role ?? ORDINARY

  globalThis.fetch = mock((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ method, url, body, locale: new Headers(init?.headers).get('x-mycelo-locale') })

    if (method === 'GET' && url === '/api/commands') {
      if (options.commandsStatus !== undefined) {
        return Promise.resolve(json({ error: { message: 'refused' } }, options.commandsStatus))
      }
      return Promise.resolve(json(commands))
    }
    if (method === 'GET' && url === '/api/plugins') {
      return Promise.resolve(json({
        enzyme: Object.keys(commands).map((name) => ({
          name,
          kind: 'enzyme',
          commands: [],
          state: 'germinated',
          enabled: true,
          ...(options.descriptions?.[name] === undefined ? {} : { description: options.descriptions[name] }),
        })),
      }))
    }
    if (method === 'GET' && url.startsWith('/api/people?role=')) {
      return Promise.resolve(json({ items: [], page: 1, perPage: 1, total: options.holders ?? 0 }))
    }
    if (method === 'GET' && url === `/api/roles/${role.name}`) return Promise.resolve(json(role))
    if (method === 'PUT' && url === `/api/roles/${role.name}/commands`) {
      if (options.putStatus !== undefined) {
        return Promise.resolve(json(options.putBody ?? { error: { message: 'refused' } }, options.putStatus))
      }
      role = { ...role, patterns: (body as { patterns: readonly string[] }).patterns }
      return Promise.resolve(json({ ok: true }))
    }
    return Promise.resolve(json({ error: { message: 'unhandled in test' } }, 404))
  }) as unknown as typeof fetch
  return { calls }
}

// Command descriptions come translated from the core, so a locale switch must refetch them —
// after the header moved, or the second request repeats the first language (spec §11, defect 31).
function LocaleSwitch(): React.JSX.Element {
  const { setLocale } = useLocale()
  return <button onClick={() => { setLocale('fr') }}>to-fr</button>
}

function renderEditor(name = 'family'): void {
  render(
    <I18nProvider>
      <MemoryRouter initialEntries={[`/roles/${name}`]}>
        <Routes><Route path="/roles/:name" element={<RoleEditor />} /></Routes>
      </MemoryRouter>
    </I18nProvider>,
  )
}

describe('the role editor screen', () => {
  it('says something went wrong when the fetch fails, rather than staying blank', async () => {
    globalThis.fetch = mock(() => Promise.resolve(json({ error: { message: 'x' } }, 500)))
    renderEditor()

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Something went wrong')
  })

  // I2: a refused /api/commands costs the per-command editor. The role's own name, its holder
  // count and its Save action come from /api/roles/:name and must survive.
  it('keeps the role and its holder count when /api/commands is refused', async () => {
    mockApi({ commandsStatus: 500, holders: 9 })
    renderEditor()

    expect(await screen.findByRole('heading', { level: 1, name: 'family' })).toBeDefined()
    expect(screen.getByText('9 people hold this role')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Save this role' })).toBeDefined()
    expect(screen.queryByRole('searchbox')).toBeNull()
    // Withheld, not `0 / 0`: the total is a count nobody confirmed.
    expect(screen.queryByText('0 / 0')).toBeNull()
  })

  // The `*` alert reads off the role's own patterns, so it survives the same refusal.
  it('keeps the * alert when /api/commands is refused', async () => {
    mockApi({ role: { name: 'family', builtin: false, patterns: ['*'] }, commandsStatus: 500 })
    renderEditor()

    expect(await screen.findByText('This role holds *')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Remove * and pick commands' })).toBeDefined()
  })

  it('renders on success, with no error banner', async () => {
    mockApi()
    renderEditor()

    await waitFor(() => { expect(screen.getByText('radarr')).toBeDefined() })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('renders a built-in role read-only: no save button, and the reason stated', async () => {
    mockApi({ role: BUILTIN, commands: { radarr: COMMANDS } })
    renderEditor('owner')

    await waitFor(() => { expect(screen.getByText('radarr')).toBeDefined() })
    expect(screen.queryByRole('button', { name: 'Save this role' })).toBeNull()
    expect(screen.getByText('Built-in roles cannot be edited.')).toBeDefined()
  })

  // A partial, non-wildcard pattern forces the checkbox list to render, so readOnly's
  // wiring through to PluginGroup is actually exercised, not just the surrounding text.
  it('disables every checkbox for a built-in role holding an explicit, non-wildcard pattern', async () => {
    mockApi({ role: { name: 'owner', builtin: true, patterns: ['radarr.add'] }, commands: { radarr: COMMANDS } })
    renderEditor('owner')

    fireEvent.click(await screen.findByText('radarr'))
    // The group box plus one per command: a read-only role offers no way in at either level.
    expect(screen.getAllByRole('checkbox')).toHaveLength(3)
    for (const box of screen.getAllByRole('checkbox')) expect((box as HTMLInputElement).disabled).toBe(true)
  })

  // The positive control for the read-only rendering above: an ordinary role stays editable.
  it('offers Save for an ordinary, non-built-in role', async () => {
    mockApi()
    renderEditor()

    await waitFor(() => { expect(screen.getByRole('button', { name: 'Save this role' })).toBeDefined() })
  })

  it('saves the patterns the operator selected, sent as the exact PUT body', async () => {
    const { calls } = mockApi({ role: { name: 'family', builtin: false, patterns: [] } })
    renderEditor()

    fireEvent.click(await screen.findByText('radarr'))
    fireEvent.click(screen.getByTestId('radarr.add'))
    fireEvent.click(screen.getByRole('button', { name: 'Save this role' }))

    await waitFor(() => { expect(calls.some((c) => c.method === 'PUT')).toBe(true) })
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ patterns: ['radarr.add'] })
  })

  // Ruling 21 concern 2 settled this class for the generated form — "a save with no feedback
  // is a regression the design does not draw only because 2c is the pre-save frame" — and the
  // rule was not carried here: the PUT persisted and the screen said nothing at all.
  it('acknowledges a save that persisted', async () => {
    mockApi({ role: { name: 'family', builtin: false, patterns: [] } })
    renderEditor()

    fireEvent.click(await screen.findByText('radarr'))
    fireEvent.click(screen.getByTestId('radarr.add'))
    fireEvent.click(screen.getByRole('button', { name: 'Save this role' }))

    expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Saved.')
  })

  it('says nothing before a save, and withdraws the acknowledgement once edited again', async () => {
    mockApi({ role: { name: 'family', builtin: false, patterns: [] } })
    renderEditor()

    fireEvent.click(await screen.findByText('radarr'))
    expect(screen.queryByRole('status')).toBeNull()

    fireEvent.click(screen.getByTestId('radarr.add'))
    fireEvent.click(screen.getByRole('button', { name: 'Save this role' }))
    expect(await screen.findByRole('status')).toBeDefined()

    fireEvent.click(screen.getByTestId('radarr.remove'))

    expect(screen.queryByRole('status')).toBeNull()
  })

  it('renders the save refusal in its own alert', async () => {
    mockApi({ role: { name: 'family', builtin: false, patterns: [] }, putStatus: 409, putBody: { error: { message: 'a duplicate pattern was refused' } } })
    renderEditor()

    await waitFor(() => { expect(screen.getByRole('button', { name: 'Save this role' })).toBeDefined() })
    fireEvent.click(screen.getByRole('button', { name: 'Save this role' }))

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'a duplicate pattern was refused')
  })

  it('the group checkbox produces the plugin.* pattern, saved verbatim', async () => {
    const { calls } = mockApi({ role: { name: 'family', builtin: false, patterns: [] } })
    renderEditor()

    fireEvent.click(await screen.findByLabelText('All radarr commands'))
    fireEvent.click(screen.getByRole('button', { name: 'Save this role' }))

    await waitFor(() => { expect(calls.some((c) => c.method === 'PUT')).toBe(true) })
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ patterns: ['radarr.*'] })
  })

  // Discriminates dropping the plugin's own prior patterns from replacing them: the group
  // checkbox must not leave a stale 'radarr.add' alongside the new 'radarr.*' it subsumes.
  it('the group checkbox replaces any pattern already held for that plugin, not just adds to it', async () => {
    const { calls } = mockApi({ role: { name: 'family', builtin: false, patterns: ['radarr.add'] } })
    renderEditor()

    fireEvent.click(await screen.findByLabelText('All radarr commands'))
    fireEvent.click(screen.getByRole('button', { name: 'Save this role' }))

    await waitFor(() => { expect(calls.some((c) => c.method === 'PUT')).toBe(true) })
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ patterns: ['radarr.*'] })
  })

  // The decision on unticking under a wildcard: refuse to guess which commands to keep.
  // Removing the wildcard clears the plugin back to zero, never to "every command but one".
  it('removing a held wildcard clears that plugin to nothing, rather than expanding it', async () => {
    mockApi({ role: { name: 'family', builtin: false, patterns: ['radarr.*'] } })
    renderEditor()

    expect(await screen.findByText('Wildcards held')).toBeDefined()
    fireEvent.click(screen.getByText('radarr'))
    expect(screen.queryAllByTestId(/^radarr\./)).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Remove radarr.*' }))

    const boxes = screen.getAllByTestId(/^radarr\./)
    expect(boxes).toHaveLength(2)
    expect(boxes.every((b) => !(b as HTMLInputElement).checked)).toBe(true)
  })
})

function buildScaleCommands(): CommandGroups {
  const plugins = ['radarr', 'plex', 'signal']
  const counts = [40, 35, 35]
  const groups: Record<string, CommandDto[]> = {}
  plugins.forEach((plugin, i) => {
    groups[plugin] = Array.from({ length: counts[i] ?? 0 }, (_, j): CommandDto => ({
      plugin,
      command: `cmd${String(j)}`,
      declared: `cmd${String(j)}`,
      qualified: `${plugin}.cmd${String(j)}`,
      description: `Command ${String(j)}`,
      capabilities: [],
    }))
  })
  return groups
}

describe('the role editor at real scale', () => {
  it('renders every plugin group with its own counter: some granted, none granted, all granted by wildcard', async () => {
    const commands = buildScaleCommands()
    mockApi({ commands, role: { name: 'family', builtin: false, patterns: ['radarr.cmd0', 'signal.*'] } })
    renderEditor()

    expect(await screen.findByText('radarr')).toBeDefined()
    expect(screen.getByText('plex')).toBeDefined()
    expect(screen.getByText('signal')).toBeDefined()

    expect(screen.getByText('1 / 40')).toBeDefined()
    expect(screen.getByText('0 / 35')).toBeDefined()
    // Appears twice: once as the group's own header term, once as a removable wildcard chip.
    // The `+ add` select does not offer it a third time — signal is already fully covered.
    expect(screen.getAllByText('signal.*')).toHaveLength(2)

    // Nothing capped or dropped: the overall counter is the sum across all three groups.
    expect(screen.getByText('36 / 110')).toBeDefined()

    fireEvent.click(screen.getByText('plex'))
    expect(screen.getAllByTestId(/^plex\./)).toHaveLength(35)
    for (const box of screen.getAllByTestId(/^plex\./)) expect((box as HTMLInputElement).checked).toBe(false)
  })

  it('refetches the commands, with the new header, when the locale changes in session', async () => {
    const { calls } = mockApi()
    render(
      <I18nProvider>
        <LocaleSwitch />
        <MemoryRouter initialEntries={['/roles/family']}>
          <Routes><Route path="/roles/:name" element={<RoleEditor />} /></Routes>
        </MemoryRouter>
      </I18nProvider>,
    )
    await waitFor(() => { expect(calls.filter((c) => c.url === '/api/commands')).toHaveLength(1) })

    fireEvent.click(screen.getByText('to-fr'))

    await waitFor(() => { expect(calls.filter((c) => c.url === '/api/commands')).toHaveLength(2) })
    expect(calls.filter((c) => c.url === '/api/commands').map((c) => c.locale)).toEqual(['en', 'fr'])
  })

})

// 22 commands over two plugins: enough for the `Filter 22 commands` label to be specific, and
// 'search' occurs in exactly one of them so a filter that opens every group turns red.
function editorCommands(): CommandGroups {
  const build = (plugin: string, names: readonly string[]): CommandDto[] => names.map((command) => ({
    plugin, command, declared: command, qualified: `${plugin}.${command}`,
    description: `${plugin} ${command}`, capabilities: [],
  }))
  return {
    radarr: build('radarr', [
      'search', 'add', 'queue', 'upcoming', 'remove', 'quality',
      'list', 'wanted', 'history', 'blocklist', 'profile', 'tag',
    ]),
    help: build('help', [
      'help', 'about', 'version', 'ping', 'whoami', 'uptime', 'status', 'commands', 'roles', 'me',
    ]),
  }
}

describe('the collapsed group list and its filter', () => {
  // design 2g: `collapsed by default` is only safe because the filter exists; a collapsed
  // list with no filter would hide every checkbox. Both halves, or neither.
  it('starts every group collapsed', async () => {
    mockApi({ commands: editorCommands(), role: { name: 'family', builtin: false, patterns: ['radarr.search'] } })
    renderEditor()

    expect(await screen.findByText('radarr')).toBeDefined()
    expect(screen.getByText('help')).toBeDefined()
    expect(screen.queryByTestId('radarr.search')).toBeNull()
    expect(screen.queryByTestId('help.help')).toBeNull()
  })

  it('opens a group whose commands match the filter, without a click', async () => {
    mockApi({ commands: editorCommands(), role: { name: 'family', builtin: false, patterns: [] } })
    renderEditor()

    fireEvent.change(await screen.findByLabelText('Filter 22 commands'), { target: { value: 'search' } })

    expect(await screen.findByTestId('radarr.search')).toBeDefined()
    // and only that group: a filter that opens everything is not a filter.
    expect(screen.queryByTestId('help.help')).toBeNull()
    // and only the matching command inside it.
    expect(screen.queryByTestId('radarr.add')).toBeNull()
  })

  it('shows only the commands the filter kept in a group opened by hand', async () => {
    mockApi({ commands: editorCommands(), role: { name: 'family', builtin: false, patterns: [] } })
    renderEditor()

    fireEvent.click(await screen.findByText('radarr'))
    expect(screen.getByTestId('radarr.add')).toBeDefined()

    fireEvent.change(screen.getByLabelText('Filter 22 commands'), { target: { value: 'search' } })

    expect(screen.getByTestId('radarr.search')).toBeDefined()
    expect(screen.queryByTestId('radarr.add')).toBeNull()
  })
})

describe('a role holding the bare star', () => {
  // design 2g frame 3: a role holding `*` never shows 104 ticks; it shows the term and the
  // one action that changes it.
  it('replaces per-command editing with the wildcard alert when the role holds *', async () => {
    mockApi({ commands: editorCommands(), role: { name: 'admin', builtin: false, patterns: ['*'] } })
    renderEditor('admin')

    expect(await screen.findByText('This role holds *')).toBeDefined()
    expect(screen.getByText('Remove * and pick commands')).toBeDefined()
    expect(screen.queryByTestId('radarr.search')).toBeNull()
    // Every group is listed, as covered rather than as ticks.
    expect(screen.getAllByText('covered')).toHaveLength(2)
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
  })

  it('falls back to per-command editing once the star is removed', async () => {
    mockApi({ commands: editorCommands(), role: { name: 'admin', builtin: false, patterns: ['*'] } })
    renderEditor('admin')

    fireEvent.click(await screen.findByText('Remove * and pick commands'))

    expect(screen.queryByText('This role holds *')).toBeNull()
    fireEvent.click(screen.getByText('radarr'))
    expect(screen.getByTestId('radarr.search')).toBeDefined()
    expect(screen.getByTestId<HTMLInputElement>('radarr.search').checked).toBe(false)
  })

  // A built-in role holding `*` is the owner: the alert states the term, and offers nothing.
  it('offers no removal on a built-in role holding *', async () => {
    mockApi({ commands: editorCommands(), role: { name: 'owner', builtin: true, patterns: ['*'] } })
    renderEditor('owner')

    expect(await screen.findByText('This role holds *')).toBeDefined()
    expect(screen.queryByText('Remove * and pick commands')).toBeNull()
  })
})

describe('the editor header', () => {
  // task 14's ?role= filter, rendered: a header count read off the unfiltered total would
  // show the whole substrate's population on every role's page.
  it('states how many people hold this role, from the role-filtered count', async () => {
    mockApi({ commands: editorCommands(), holders: 9 })
    renderEditor()

    expect(await screen.findByText('9 people hold this role')).toBeDefined()
  })

  it('says one person, not 1 people, when a single holder has the role', async () => {
    mockApi({ commands: editorCommands(), holders: 1 })
    renderEditor()

    expect(await screen.findByText('1 person holds this role')).toBeDefined()
  })

  // Cancel is the control the SPA lacked: an operator who unticked half a role needs a way
  // back to the fetched value without a reload.
  it('resets the patterns to the fetched value when Cancel is used', async () => {
    const { calls } = mockApi({
      commands: editorCommands(), role: { name: 'family', builtin: false, patterns: ['radarr.search'] },
    })
    renderEditor()

    fireEvent.change(await screen.findByLabelText('Filter 22 commands'), { target: { value: 'search' } })
    fireEvent.click(screen.getByTestId('radarr.search'))
    expect(screen.getByTestId<HTMLInputElement>('radarr.search').checked).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByTestId<HTMLInputElement>('radarr.search').checked).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Save this role' }))
    await waitFor(() => { expect(calls.some((c) => c.method === 'PUT')).toBe(true) })
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ patterns: ['radarr.search'] })
  })

  it('renders the plugin description as the group subtitle', async () => {
    mockApi({ commands: editorCommands(), descriptions: { radarr: 'films', help: 'the command list' } })
    renderEditor()

    expect(await screen.findByText('films')).toBeDefined()
    expect(screen.getByText('the command list')).toBeDefined()
  })
})

describe('the group checkbox', () => {
  it('grants the whole plugin as plugin.*, and clears it back to nothing', async () => {
    const { calls } = mockApi({ role: { name: 'family', builtin: false, patterns: [] } })
    renderEditor()

    const box = await screen.findByLabelText('All radarr commands')
    fireEvent.click(box)
    fireEvent.click(screen.getByRole('button', { name: 'Save this role' }))
    await waitFor(() => { expect(calls.some((c) => c.method === 'PUT')).toBe(true) })
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ patterns: ['radarr.*'] })

    fireEvent.click(screen.getByLabelText('All radarr commands'))
    fireEvent.click(screen.getByRole('button', { name: 'Save this role' }))
    await waitFor(() => { expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(2) })
    expect(calls.filter((c) => c.method === 'PUT')[1]?.body).toEqual({ patterns: [] })
  })

  // coversPlugin answers 'some' for any explicit pattern, so reading the box off it alone left
  // a fully ticked group indeterminate beside a green `2 / 2`.
  it('is checked when explicit patterns already cover every command, with no wildcard held', async () => {
    const { calls } = mockApi({ role: { name: 'family', builtin: false, patterns: ['radarr.add', 'radarr.remove'] } })
    renderEditor()

    const box = await screen.findByLabelText<HTMLInputElement>('All radarr commands')
    expect(box.checked).toBe(true)
    expect(box.indeterminate).toBe(false)
    // Checked, yet the group's own term stays an em dash: the role holds two ticks, not radarr.*
    // (which the `+ add` select still offers, since a wildcard would also cover later commands).
    const group = screen.getByText('radarr').closest('section')
    expect(group).not.toBeNull()
    expect(group !== null && within(group).queryByText('radarr.*')).toBeNull()
    expect(group !== null && within(group).getByText('—')).toBeDefined()
    expect(screen.getAllByText('2 / 2')).toHaveLength(2)

    // Unchecking a fully-explicit group clears those commands rather than negating a wildcard.
    fireEvent.click(box)
    fireEvent.click(screen.getByRole('button', { name: 'Save this role' }))
    await waitFor(() => { expect(calls.some((c) => c.method === 'PUT')).toBe(true) })
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ patterns: [] })
  })

  // The tri-state: 'some' is neither on nor off, and rendering it as off would invite an
  // operator to tick it and silently widen the role to plugin.*.
  it('is indeterminate when only part of the plugin is granted, checked when all of it is', async () => {
    mockApi({ role: { name: 'family', builtin: false, patterns: ['radarr.add'] } })
    renderEditor()

    const partial = await screen.findByLabelText<HTMLInputElement>('All radarr commands')
    expect(partial.indeterminate).toBe(true)
    expect(partial.checked).toBe(false)

    fireEvent.click(screen.getByLabelText('All radarr commands'))

    const full = screen.getByLabelText<HTMLInputElement>('All radarr commands')
    expect(full.checked).toBe(true)
    expect(full.indeterminate).toBe(false)
  })

  it('is disabled for a built-in role', async () => {
    mockApi({ role: { name: 'owner', builtin: true, patterns: ['radarr.add'] } })
    renderEditor('owner')

    expect((await screen.findByLabelText<HTMLInputElement>('All radarr commands')).disabled).toBe(true)
  })
})

describe('adding a wildcard from the editor', () => {
  it('appends plugin.* for the plugin chosen, and drops that plugin’s explicit patterns', async () => {
    const { calls } = mockApi({
      commands: editorCommands(), role: { name: 'family', builtin: false, patterns: ['radarr.add', 'help.help'] },
    })
    renderEditor()

    fireEvent.change(
      await screen.findByLabelText('Plugin to add a wildcard for'), { target: { value: 'radarr' } },
    )
    fireEvent.click(screen.getByRole('button', { name: '+ add' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save this role' }))

    await waitFor(() => { expect(calls.some((c) => c.method === 'PUT')).toBe(true) })
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ patterns: ['help.help', 'radarr.*'] })
  })
})
