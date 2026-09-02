import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { MemoryRouter, Route, Routes } from 'react-router'
import { I18nProvider } from '../../src/i18n.tsx'
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

describe('the role editor', () => {
  // design §12: a wildcard drawn as every box ticked says something false about a role
  // that deliberately does not enumerate.
  it('renders a wildcard as a wildcard, with no checkbox ticked', () => {
    renderGroup(['radarr.*'])

    expect(screen.getByText('radarr.*')).toBeDefined()
    expect(screen.queryAllByRole('checkbox', { checked: true })).toHaveLength(0)
  })

  it('ticks exactly the commands an explicit pattern names', () => {
    renderGroup(['radarr.add'])

    const ticked = screen.getAllByRole('checkbox').filter((c) => (c as HTMLInputElement).checked)
    expect(ticked).toHaveLength(1)
  })

  // The counter is what makes 104 commands legible; asserting the plural is the point.
  it('counts the granted commands against the plugin total', () => {
    renderGroup(['radarr.add'])
    expect(screen.getByText('1 / 2')).toBeDefined()
  })

  // The silent case: a bare '*' must render every group as a wildcard, never as ticks,
  // and the counter must not claim a false 'n / n' either.
  it('renders a bare star as a wildcard for every group, with no checkboxes at all', () => {
    render(
      <I18nProvider>
        <PluginGroup plugin="radarr" commands={COMMANDS} patterns={['*']} onToggle={() => undefined} />
      </I18nProvider>,
    )

    expect(screen.getByText('*')).toBeDefined()
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.queryByText('2 / 2')).toBeNull()
  })

  it('renders a built-in group read-only: checkboxes disabled, no select-all', () => {
    render(
      <I18nProvider>
        <PluginGroup
          plugin="radarr" commands={COMMANDS} patterns={['radarr.add']} onToggle={() => undefined} readOnly
        />
      </I18nProvider>,
    )

    for (const box of screen.getAllByRole('checkbox')) expect((box as HTMLInputElement).disabled).toBe(true)
    expect(screen.queryByText('Select all')).toBeNull()
  })

  it('offers select-all, which reports the plugin whose commands should all be granted', () => {
    const seen: string[] = []
    render(
      <I18nProvider>
        <PluginGroup
          plugin="radarr" commands={COMMANDS} patterns={[]} onToggle={() => undefined}
          onSelectAll={(p) => seen.push(p)}
        />
      </I18nProvider>,
    )

    fireEvent.click(screen.getByText('Select all'))
    expect(seen).toEqual(['radarr'])
  })
})

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

interface Call { method: string, url: string, body: unknown }

const ORDINARY: RoleDto = { name: 'family', builtin: false, patterns: ['radarr.add'] }
const BUILTIN: RoleDto = { name: 'owner', builtin: true, patterns: ['*'] }

/** A stateful fake serving what RoleEditor calls, tracking every call it saw. */
function mockApi(
  options: { commands?: CommandGroups, role?: RoleDto, putStatus?: number, putBody?: unknown } = {},
): { calls: Call[] } {
  const calls: Call[] = []
  const commands = options.commands ?? { radarr: COMMANDS }
  let role = options.role ?? ORDINARY

  globalThis.fetch = mock((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ method, url, body })

    if (method === 'GET' && url === '/api/commands') return Promise.resolve(json(commands))
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

    await waitFor(() => { expect(screen.getAllByRole('checkbox')).toHaveLength(2) })
    for (const box of screen.getAllByRole('checkbox')) expect((box as HTMLInputElement).disabled).toBe(true)
    expect(screen.queryByText('Select all')).toBeNull()
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

    await waitFor(() => { expect(screen.getByText('radarr')).toBeDefined() })
    fireEvent.click(screen.getByTestId('radarr.add'))
    fireEvent.click(screen.getByRole('button', { name: 'Save this role' }))

    await waitFor(() => { expect(calls.some((c) => c.method === 'PUT')).toBe(true) })
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ patterns: ['radarr.add'] })
  })

  it('renders the save refusal in its own alert', async () => {
    mockApi({ role: { name: 'family', builtin: false, patterns: [] }, putStatus: 409, putBody: { error: { message: 'a duplicate pattern was refused' } } })
    renderEditor()

    await waitFor(() => { expect(screen.getByRole('button', { name: 'Save this role' })).toBeDefined() })
    fireEvent.click(screen.getByRole('button', { name: 'Save this role' }))

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'a duplicate pattern was refused')
  })

  it('select-all on a plugin produces the plugin.* pattern, saved verbatim', async () => {
    const { calls } = mockApi({ role: { name: 'family', builtin: false, patterns: [] } })
    renderEditor()

    await waitFor(() => { expect(screen.getByText('radarr')).toBeDefined() })
    fireEvent.click(screen.getByText('Select all'))
    fireEvent.click(screen.getByRole('button', { name: 'Save this role' }))

    await waitFor(() => { expect(calls.some((c) => c.method === 'PUT')).toBe(true) })
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ patterns: ['radarr.*'] })
  })

  // Discriminates dropping the plugin's own prior patterns from replacing them: select-all
  // must not leave a stale 'radarr.add' alongside the new 'radarr.*' it subsumes.
  it('select-all replaces any pattern already held for that plugin, not just adds to it', async () => {
    const { calls } = mockApi({ role: { name: 'family', builtin: false, patterns: ['radarr.add'] } })
    renderEditor()

    await waitFor(() => { expect(screen.getByText('radarr')).toBeDefined() })
    fireEvent.click(screen.getByText('Select all'))
    fireEvent.click(screen.getByRole('button', { name: 'Save this role' }))

    await waitFor(() => { expect(calls.some((c) => c.method === 'PUT')).toBe(true) })
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ patterns: ['radarr.*'] })
  })

  // The decision on unticking under a wildcard: refuse to guess which commands to keep.
  // Removing the wildcard clears the plugin back to zero, never to "every command but one".
  it('removing a held wildcard clears that plugin to nothing, rather than expanding it', async () => {
    mockApi({ role: { name: 'family', builtin: false, patterns: ['radarr.*'] } })
    renderEditor()

    await waitFor(() => { expect(screen.getByText('Wildcards held')).toBeDefined() })
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Remove radarr.*' }))

    const boxes = screen.getAllByRole('checkbox')
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

    await waitFor(() => { expect(screen.getByText('radarr')).toBeDefined() })
    expect(screen.getByText('plex')).toBeDefined()
    expect(screen.getByText('signal')).toBeDefined()

    expect(screen.getByText('1 / 40')).toBeDefined()
    expect(screen.getByText('0 / 35')).toBeDefined()
    // Appears twice: once as the group's own header term, once as a removable wildcard chip.
    expect(screen.getAllByText('signal.*')).toHaveLength(2)

    // Nothing capped or dropped: the overall counter is the sum across all three groups.
    expect(screen.getByText('36 / 110')).toBeDefined()

    for (const box of screen.getAllByTestId(/^plex\./)) expect((box as HTMLInputElement).checked).toBe(false)
  })
})
