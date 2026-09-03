import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { MemoryRouter } from 'react-router'
import { I18nProvider } from '../../src/i18n.tsx'
import { Plugins } from '../../src/screens/Plugins.tsx'
import type { PluginDto, PluginGroups } from '../../src/api/types.ts'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

const GROUPS: PluginGroups = {
  hypha: [{ name: 'signal', kind: 'hypha', commands: [], state: 'germinated', enabled: true }],
  rhiza: [
    { name: 'radarr', kind: 'rhiza', commands: [], state: 'germinated', enabled: true },
    { name: 'plex', kind: 'rhiza', commands: [], state: 'dormant', enabled: true, reason: 'radarr is not installed' },
  ],
  enzyme: [{ name: 'help', kind: 'enzyme', commands: ['help'], state: 'pending', enabled: true }],
  inhibitor: [],
  unknown: [],
}

function serve(body: unknown): void {
  globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  })))
}

function serveError(): void {
  globalThis.fetch = mock(() => Promise.resolve(new Response('{"error":{"message":"x"}}', {
    status: 500, headers: { 'content-type': 'application/json' },
  })))
}

describe('the plugins list', () => {
  it('names every plugin of a group, not just the first', async () => {
    serve(GROUPS)
    render(<I18nProvider><MemoryRouter><Plugins /></MemoryRouter></I18nProvider>)

    await waitFor(() => { expect(screen.getByText('radarr')).toBeDefined() })
    expect(screen.getByText('plex')).toBeDefined()
    // 'signal' and 'radarr' are both germinated: two badges, not collapsed to one.
    expect(screen.getAllByText('Germinated')).toHaveLength(2)
  })

  // Discriminates ORDER's own sequence (api/types.ts): sections must render hyphae before
  // rhizae, not merely all of them.
  it('renders the kind sections in hypha, rhiza, enzyme, inhibitor order', async () => {
    serve(GROUPS)
    render(<I18nProvider><MemoryRouter><Plugins /></MemoryRouter></I18nProvider>)

    await waitFor(() => { expect(screen.getByText('Hyphae')).toBeDefined() })
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(headings.findIndex((h) => h?.includes('Hyphae'))).toBeLessThan(
      headings.findIndex((h) => h?.includes('Rhizae')),
    )
  })

  // brief §6: the subtitle is what makes the vocabulary learnable.
  it('carries the plain-language subtitle beside each mycological header', async () => {
    serve(GROUPS)
    render(<I18nProvider><MemoryRouter><Plugins /></MemoryRouter></I18nProvider>)

    await waitFor(() => { expect(screen.getByText('Hyphae')).toBeDefined() })
    expect(screen.getByText('channels')).toBeDefined()
    expect(screen.getByText('connected systems')).toBeDefined()
  })

  // brief §5: the metaphor never replaces information.
  it('shows the literal reason beside a dormant plugin, never the word alone', async () => {
    serve(GROUPS)
    render(<I18nProvider><MemoryRouter><Plugins /></MemoryRouter></I18nProvider>)

    await waitFor(() => { expect(screen.getByText('plex')).toBeDefined() })
    expect(screen.getByText(/radarr is not installed/)).toBeDefined()
  })

  // 'pending' is one phase old and its whole point is being visible.
  it('renders a pending plugin as awaiting a restart rather than as breakage', async () => {
    serve(GROUPS)
    render(<I18nProvider><MemoryRouter><Plugins /></MemoryRouter></I18nProvider>)

    await waitFor(() => { expect(screen.getByText('help')).toBeDefined() })
    expect(screen.getByText('Awaiting restart')).toBeDefined()
  })

  it('renders a disabled plugin with its own word, distinct from dormant', async () => {
    serve({ ...GROUPS, hypha: [{ name: 'quiet', kind: 'hypha', commands: [], state: 'disabled', enabled: false }] })
    render(<I18nProvider><MemoryRouter><Plugins /></MemoryRouter></I18nProvider>)

    // Scoped to the section: the filter chip row carries the same word (1b's `Disabled 1`).
    const section = await screen.findByTestId('kind-section-hypha')
    const badge = within(section).getByText('Disabled')
    expect(badge.className).toContain('text-idle')
  })

  it('names the empty message inside the kind that has nothing, not just anywhere on screen', async () => {
    serve(GROUPS)
    render(<I18nProvider><MemoryRouter><Plugins /></MemoryRouter></I18nProvider>)

    const inhibitorSection = await screen.findByTestId('kind-section-inhibitor')
    expect(within(inhibitorSection).getByText('No plugin of this kind.')).toBeDefined()
  })

  // design §7.4: a plugin nobody installed through a source still says where it came from.
  it('marks a plugin with no source as checked out locally', async () => {
    serve(GROUPS)
    render(<I18nProvider><MemoryRouter><Plugins /></MemoryRouter></I18nProvider>)

    await waitFor(() => { expect(screen.getByText('signal')).toBeDefined() })
    expect(screen.getAllByText('checked out locally').length).toBeGreaterThan(0)
  })

  it('says something went wrong when the fetch itself fails, rather than staying blank', async () => {
    serveError()
    render(<I18nProvider><MemoryRouter><Plugins /></MemoryRouter></I18nProvider>)

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Something went wrong')
  })

  it('renders the list on success, with no error banner', async () => {
    serve(GROUPS)
    render(<I18nProvider><MemoryRouter><Plugins /></MemoryRouter></I18nProvider>)

    await waitFor(() => { expect(screen.getByText('signal')).toBeDefined() })
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

// brief §3: "20-40 plugins", never three sample rows. build() fills every kind so a section
// collapsed to its first element, or a kind silently dropped from the page, turns a specific
// per-section assertion red rather than a generic "somewhere on screen" one.
function build(kind: PluginDto['kind'], count: number): PluginDto[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `${kind ?? 'unknown'}-${i + 1}`,
    ...(kind === undefined ? {} : { kind }),
    commands: [],
    state: 'germinated' as const,
    enabled: true,
  }))
}

const SCALE: PluginGroups = {
  hypha: build('hypha', 6),
  rhiza: build('rhiza', 8),
  enzyme: build('enzyme', 10),
  inhibitor: build('inhibitor', 4),
  unknown: build(undefined, 2),
}

describe('the plugins list at scale', () => {
  it('keeps every kind\'s plugins inside that kind\'s own section, none scattered or dropped', async () => {
    serve(SCALE)
    render(<I18nProvider><MemoryRouter><Plugins /></MemoryRouter></I18nProvider>)

    await waitFor(() => { expect(screen.getByTestId('kind-section-hypha')).toBeDefined() })

    for (const [kind, plugins] of Object.entries(SCALE)) {
      const section = screen.getByTestId(`kind-section-${kind}`)
      const items = within(section).getAllByRole('listitem')
      expect(items).toHaveLength(plugins.length)
      for (const plugin of plugins) {
        expect(within(section).getByText(plugin.name)).toBeDefined()
      }
    }

    // The whole registry is 30 plugins; nothing was silently capped.
    expect(screen.getAllByRole('listitem')).toHaveLength(30)
  })
})

const EMPTY_GROUPS: PluginGroups = { hypha: [], rhiza: [], enzyme: [], inhibitor: [], unknown: [] }

function renderPlugins(): void {
  render(<I18nProvider><MemoryRouter><Plugins /></MemoryRouter></I18nProvider>)
}

describe('the plugins list, sorted state-first', () => {
  // design note 1b: rows are sorted state-first inside each group, so a dormant plugin
  // surfaces without filtering. api/routes/plugins.ts builds its germinated entries before
  // its dormant ones, so a screen that renders the route's order renders exactly the wrong one.
  it('lists a dormant plugin above a germinated one, whatever order the route sent', async () => {
    serve({
      ...EMPTY_GROUPS,
      enzyme: [
        { name: 'help', kind: 'enzyme', commands: ['help'], state: 'germinated', enabled: true },
        {
          name: 'radarr',
          kind: 'enzyme',
          commands: [],
          state: 'dormant',
          enabled: true,
          reason: 'apiKey: missing required field',
        },
        { name: 'links', kind: 'enzyme', commands: ['links'], state: 'germinated', enabled: true },
      ],
    })
    renderPlugins()

    const names = (await screen.findAllByTestId('plugin-name')).map((e) => e.textContent)
    expect(names).toEqual(['radarr', 'help', 'links'])
  })

  it('keeps a stable alphabetical order inside one state', async () => {
    serve({
      ...EMPTY_GROUPS,
      rhiza: [
        { name: 'zeta', kind: 'rhiza', commands: [], state: 'germinated', enabled: true },
        { name: 'alpha', kind: 'rhiza', commands: [], state: 'germinated', enabled: true },
      ],
    })
    renderPlugins()

    const names = (await screen.findAllByTestId('plugin-name')).map((e) => e.textContent)
    expect(names).toEqual(['alpha', 'zeta'])
  })
})

describe('the kind group header', () => {
  // R5: the pair is the ruling. A class-list assertion on `sticky` alone stays green with
  // `md:static` deleted, and the header would then stick on the desktop frame that draws it flat.
  it('sticks on mobile scroll only', async () => {
    serve(GROUPS)
    renderPlugins()

    const section = await screen.findByTestId('kind-section-hypha')
    const header = within(section).getByRole('heading', { level: 2 })
    expect(header.className).toContain('sticky')
    expect(header.className).toContain('md:static')
  })

  // R5: both words must be reachable on their own, which is what the three text nodes buy.
  it('renders the mycological term and its subtitle as separate accessible text', async () => {
    serve(GROUPS)
    renderPlugins()

    const section = await screen.findByTestId('kind-section-hypha')
    expect(within(section).getByText('Hyphae')).toBeDefined()
    expect(within(section).getByText('channels')).toBeDefined()
    expect(within(section).getByText('where the bot listens and speaks')).toBeDefined()
  })

  it('counts the group and names how many of it are dormant', async () => {
    serve(GROUPS)
    renderPlugins()

    const section = await screen.findByTestId('kind-section-rhiza')
    expect(within(section).getByText('2 · 1 dormant')).toBeDefined()
  })

  // The two meta branches are different sentences, not one with a zero in it.
  it('says every plugin germinated for a group with nothing dormant', async () => {
    serve(GROUPS)
    renderPlugins()

    const section = await screen.findByTestId('kind-section-hypha')
    expect(within(section).getByText('1 · all germinated')).toBeDefined()
  })

  it('collapses a group without dropping its header', async () => {
    serve(GROUPS)
    renderPlugins()

    const section = await screen.findByTestId('kind-section-rhiza')
    expect(within(section).getAllByRole('listitem')).toHaveLength(2)

    fireEvent.click(within(section).getByRole('button', { expanded: true }))

    expect(within(section).queryAllByRole('listitem')).toHaveLength(0)
    expect(within(section).getByText('Rhizae')).toBeDefined()
  })
})

const SEARCHABLE: PluginGroups = {
  ...EMPTY_GROUPS,
  enzyme: [
    {
      name: 'meteo',
      kind: 'enzyme',
      commands: ['weather'],
      state: 'germinated',
      enabled: true,
      description: 'Forecast for a place',
    },
    {
      name: 'dice',
      kind: 'enzyme',
      commands: ['roll'],
      state: 'germinated',
      enabled: true,
      description: 'Roll dice',
    },
  ],
}

const MIXED: PluginGroups = {
  ...EMPTY_GROUPS,
  rhiza: [
    { name: 'plex', kind: 'rhiza', commands: [], state: 'dormant', enabled: true, reason: 'radarr is not installed' },
    { name: 'sonarr', kind: 'rhiza', commands: [], state: 'germinated', enabled: true },
    { name: 'quiet', kind: 'rhiza', commands: [], state: 'disabled', enabled: false },
  ],
}

function shownNames(): (string | null)[] {
  return screen.getAllByTestId('plugin-name').map((e) => e.textContent)
}

describe('the plugins list chrome', () => {
  // Both numbers are joined client-side from the payload task 14 fills; the singular is the
  // branch a substrate with one command actually renders.
  it('counts the installed plugins and the commands they declare', async () => {
    serve(GROUPS)
    renderPlugins()

    expect(await screen.findByText('4 installed · 1 command')).toBeDefined()
  })

  it('uses the plural for a substrate declaring more than one command', async () => {
    serve(SEARCHABLE)
    renderPlugins()

    expect(await screen.findByText('2 installed · 2 commands')).toBeDefined()
  })

  it('offers inoculation, which is a source away', async () => {
    serve(GROUPS)
    renderPlugins()

    const link = await screen.findByRole('link', { name: 'Inoculate' })
    expect(link.getAttribute('href')).toBe('/sources')
  })

  // design note 1b names all three corpora. A search over names alone passes a fixture whose
  // description and command name repeat the name, so each term below matches on one field only.
  it('finds a plugin by its command name, not by its own name alone', async () => {
    serve(SEARCHABLE)
    renderPlugins()

    await waitFor(() => { expect(screen.getByText('meteo')).toBeDefined() })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'weather' } })

    expect(shownNames()).toEqual(['meteo'])
  })

  it('finds a plugin by what it does', async () => {
    serve(SEARCHABLE)
    renderPlugins()

    await waitFor(() => { expect(screen.getByText('meteo')).toBeDefined() })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Forecast' } })

    expect(shownNames()).toEqual(['meteo'])
  })

  it('finds a plugin by its own name', async () => {
    serve(SEARCHABLE)
    renderPlugins()

    await waitFor(() => { expect(screen.getByText('meteo')).toBeDefined() })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'dice' } })

    expect(shownNames()).toEqual(['dice'])
  })

  it('sends a search that matches nothing to the sources instead of showing empty groups', async () => {
    serve(SEARCHABLE)
    renderPlugins()

    await waitFor(() => { expect(screen.getByText('meteo')).toBeDefined() })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'grafna' } })

    expect(screen.getByText('No installed plugin matches “grafna”')).toBeDefined()
    expect(screen.getByRole('link', { name: 'Search the sources instead' }).getAttribute('href')).toBe('/sources')
    expect(screen.queryAllByTestId('plugin-name')).toHaveLength(0)
    expect(screen.queryByText('No plugin of this kind.')).toBeNull()
  })

  it('counts each state on its own filter chip', async () => {
    serve(MIXED)
    renderPlugins()

    await waitFor(() => { expect(screen.getByText('plex')).toBeDefined() })
    expect(screen.getByRole('button', { name: /^All/ }).textContent).toBe('All3')
    expect(screen.getByRole('button', { name: /^Dormant/ }).textContent).toBe('Dormant1')
    expect(screen.getByRole('button', { name: /^Disabled/ }).textContent).toBe('Disabled1')
  })

  // Three states in the fixture, so a filter that returns everything, or the wrong one of the
  // two non-germinated states, is red rather than green.
  it('narrows the list to the state its chip names', async () => {
    serve(MIXED)
    renderPlugins()

    await waitFor(() => { expect(screen.getByText('plex')).toBeDefined() })

    fireEvent.click(screen.getByRole('button', { name: /^Dormant/ }))
    expect(shownNames()).toEqual(['plex'])

    fireEvent.click(screen.getByRole('button', { name: /^Disabled/ }))
    expect(shownNames()).toEqual(['quiet'])

    fireEvent.click(screen.getByRole('button', { name: /^All/ }))
    expect(shownNames()).toEqual(['plex', 'quiet', 'sonarr'])
  })
})
