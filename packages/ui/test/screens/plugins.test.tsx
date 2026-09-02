import { render, screen, waitFor, within } from '@testing-library/react'
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

    await waitFor(() => { expect(screen.getByText('quiet')).toBeDefined() })
    const badge = screen.getByText('Disabled')
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
