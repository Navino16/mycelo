import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { MemoryRouter, Route, Routes } from 'react-router'
import { HealthContext } from '../../src/health.tsx'
import { I18nProvider } from '../../src/i18n.tsx'
import { PluginDetail } from '../../src/screens/PluginDetail.tsx'
import type { PluginDetailDto, RuntimeHealth } from '../../src/api/types.ts'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

const DETAIL: PluginDetailDto = {
  name: 'radarr',
  kind: 'rhiza',
  commands: [],
  state: 'germinated',
  enabled: true,
  demands: {
    requires: [],
    scopes: ['health.read'],
    externals: [],
    commands: [],
  },
  mounted: ['health.read'],
}

const GERMINATED: RuntimeHealth = {
  mode: 'germinated',
  dormant: [],
  enforcingBlocked: [],
  rhizas: [],
  blockedSinceBoot: 0,
}

const DEGRADED: RuntimeHealth = { ...GERMINATED, mode: 'degraded' }

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

// The screen reads the runtime's mode to decide whether a germination retry is even offered,
// so it needs a HealthContext; useHealth throws without one.
function renderDetail(health: RuntimeHealth | null = GERMINATED): void {
  render(
    <I18nProvider>
      <HealthContext value={{ health, error: false, refresh: () => Promise.resolve() }}>
        <MemoryRouter initialEntries={['/plugins/radarr']}>
          <Routes><Route path="/plugins/:name" element={<PluginDetail />} /></Routes>
        </MemoryRouter>
      </HealthContext>
    </I18nProvider>,
  )
}

describe('the plugin detail screen', () => {
  it('says something went wrong when the fetch fails, rather than staying blank', async () => {
    serveError()
    renderDetail()

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Something went wrong')
  })

  it('renders the plugin on success, with no error banner', async () => {
    serve(DETAIL)
    renderDetail()

    await waitFor(() => { expect(screen.getByText('radarr')).toBeDefined() })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  // Discriminates the `source !== undefined` ternary's branches: a locally checked-out
  // plugin (no source) and a spore installed from a source must read as different things.
  it('names the local checkout when the plugin carries no source', async () => {
    serve(DETAIL)
    renderDetail()

    await waitFor(() => { expect(screen.getByText('checked out locally')).toBeDefined() })
  })

  it('names the source a spore was installed from, not the local-checkout label', async () => {
    serve({ ...DETAIL, source: 'github:example/mirror' })
    renderDetail()

    await waitFor(() => { expect(screen.getByText('github:example/mirror')).toBeDefined() })
    expect(screen.queryByText('checked out locally')).toBeNull()
  })

  // The two live on different tabs since 1c, so this walks to each in turn: 'health.read'
  // appears once as a sentence (declared) and once as a raw scope (mounted).
  it('shows what germination granted, and what the manifest declared', async () => {
    serve(DETAIL)
    renderDetail()

    await waitFor(() => { expect(screen.getByText('Granted at germination')).toBeDefined() })
    expect(screen.getByText('health.read')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Requirements' }))

    expect(screen.getByText('Declared in its manifest')).toBeDefined()
    expect(screen.getByText('See the health of connected systems')).toBeDefined()
  })

  it('shows the dormant diagnosis for a dormant plugin, with the raw reason', async () => {
    serve({
      ...DETAIL,
      state: 'dormant',
      reason: "requires rhiza 'plex', which is not installed",
      mounted: undefined,
    })
    renderDetail()

    await waitFor(() => { expect(screen.getByText('Something it depends on is missing')).toBeDefined() })
    expect(screen.getByText("requires rhiza 'plex', which is not installed")).toBeDefined()
  })

  it('omits the mounted section for a plugin that never germinated', async () => {
    serve({ ...DETAIL, state: 'dormant', reason: 'create() returned undefined, expected an object', mounted: undefined })
    renderDetail()

    await waitFor(() => { expect(screen.getByText('radarr')).toBeDefined() })
    expect(screen.queryByText('Granted at germination')).toBeNull()
  })
})

const DORMANT: PluginDetailDto = {
  name: 'radarr',
  kind: 'enzyme',
  commands: ['radarr.search', 'radarr.add', 'radarr.queue'],
  state: 'dormant',
  enabled: true,
  strain: '3.1.0',
  description: 'Search and add films from a conversation',
  reason: "requires rhiza 'plex', which is not installed",
  demands: {
    requires: [{ targets: ['plex'], anyOf: false, optional: false, scopes: [] }],
    scopes: ['health.read'],
    externals: [],
    commands: [],
  },
}

describe('the dormant plugin detail, as 1c draws it', () => {
  // R1: crit belongs to the mute bot alone (design note 2j), and this header badge is the
  // second surface that painted a dormant plugin red.
  it('badges the header amber, never the mute colour', async () => {
    serve(DORMANT)
    renderDetail()

    const badge = await screen.findByText('Dormant')
    expect(badge.getAttribute('data-tone')).toBe('warn')
  })

  // R3, design note 1c: "Dormant never appears without a literal cause line next to it."
  it('names the literal cause wherever the word Dormant appears', async () => {
    serve(DORMANT)
    renderDetail()

    expect(await screen.findByText('Dormant')).toBeDefined()
    expect(screen.getByText("requires rhiza 'plex', which is not installed")).toBeDefined()
  })

  it('trails back to the plugins list through the plugin kind', async () => {
    serve(DORMANT)
    renderDetail()

    const trail = await screen.findByRole('navigation', { name: 'breadcrumb' })
    expect(trail.textContent).toContain('Enzymes · commands')
    expect(screen.getByRole('link', { name: 'Plugins' }).getAttribute('href')).toBe('/plugins')
  })

  // Each chip is a different field of the payload, so a header that lost one of them is red
  // rather than green on "some chip rendered".
  it('carries the kind, the strain, the enabled state and the command count as chips', async () => {
    serve(DORMANT)
    renderDetail()

    expect(await screen.findByText('enzyme · commands')).toBeDefined()
    expect(screen.getByText('strain 3.1.0')).toBeDefined()
    expect(screen.getByText('enabled')).toBeDefined()
    expect(screen.getByText('3 commands')).toBeDefined()
    expect(screen.getByText('Search and add films from a conversation')).toBeDefined()
  })

  it('says a disabled plugin is disabled, not enabled', async () => {
    serve({ ...DORMANT, enabled: false, state: 'disabled' })
    renderDetail()

    expect(await screen.findByText('disabled')).toBeDefined()
    expect(screen.queryByText('enabled')).toBeNull()
  })

  // task 14 fills `commands` for a dormant enzyme; before it the list was empty and this
  // section could not exist.
  it('lists the commands that answer nothing while it sleeps', async () => {
    serve(DORMANT)
    renderDetail()

    expect(await screen.findByText('What is unavailable while it sleeps')).toBeDefined()
    expect(screen.getByText('All 3 commands answer nothing. Callers see silence, not an error.')).toBeDefined()
    expect(screen.getByText('radarr.queue')).toBeDefined()
  })

  it('does not say "all 1 commands" for a plugin declaring one', async () => {
    serve({ ...DORMANT, commands: ['radarr.search'] })
    renderDetail()

    expect(await screen.findByText('Its one command answers nothing. Callers see silence, not an error.'))
      .toBeDefined()
  })

  it('states that the germination log does not exist, rather than leaving the space blank', async () => {
    serve(DORMANT)
    renderDetail()

    expect(await screen.findByText('Germination log unavailable')).toBeDefined()
  })

  it('sends the Configuration tab to the settings route instead of switching a panel', async () => {
    serve(DORMANT)
    renderDetail()

    const link = await screen.findByRole('link', { name: 'Configuration' })
    expect(link.getAttribute('href')).toBe('/plugins/radarr/settings')
  })

  it('shows the commands under their own tab, and drops the diagnosis while there', async () => {
    serve(DORMANT)
    renderDetail()

    await waitFor(() => { expect(screen.getByText('Dormant')).toBeDefined() })
    fireEvent.click(screen.getByRole('button', { name: /^Commands/ }))

    expect(screen.getByText('radarr.add')).toBeDefined()
    expect(screen.queryByText('Something it depends on is missing')).toBeNull()
  })

  // api/routes/health.ts refuses the retry outside degraded mode, so a button offered there
  // can only produce a refusal the operator did not ask for.
  it('offers no germination retry while the runtime is germinated', async () => {
    serve(DORMANT)
    renderDetail(GERMINATED)

    await waitFor(() => { expect(screen.getByText('Dormant')).toBeDefined() })
    expect(screen.queryByRole('button', { name: 'Retry germination' })).toBeNull()
  })

  it('retries germination while the runtime is degraded, through the route that allows it', async () => {
    const calls: string[] = []
    globalThis.fetch = mock((url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      return Promise.resolve(new Response(JSON.stringify(DORMANT), {
        headers: { 'content-type': 'application/json' },
      }))
    }) as unknown as typeof fetch
    renderDetail(DEGRADED)

    fireEvent.click(await screen.findByRole('button', { name: 'Retry germination' }))

    await waitFor(() => { expect(calls).toContain('POST /api/germination/retry') })
  })

  it('disables the plugin through its own route', async () => {
    const calls: string[] = []
    globalThis.fetch = mock((url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      return Promise.resolve(new Response(JSON.stringify(DORMANT), {
        headers: { 'content-type': 'application/json' },
      }))
    }) as unknown as typeof fetch
    renderDetail()

    fireEvent.click(await screen.findByRole('button', { name: 'Disable' }))

    await waitFor(() => { expect(calls).toContain('POST /api/plugins/radarr/disable') })
  })
})

/**
 * Answers the first GET of the plugin with `first` and every later one with `second`. Keyed on
 * the URL, not on a GET counter: any other GET reaching this mock first would consume the
 * `first` slot and serve the screen the already-acted-on state.
 */
function serveThenReload(first: unknown, second: unknown, calls: string[]): void {
  let reads = 0
  globalThis.fetch = mock((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push(`${method} ${url}`)
    let body: unknown = { ok: true }
    if (method === 'GET' && url === '/api/plugins/radarr') {
      reads += 1
      body = reads === 1 ? first : second
    }
    return Promise.resolve(new Response(JSON.stringify(body), {
      headers: { 'content-type': 'application/json' },
    }))
  }) as unknown as typeof fetch
}

describe('an action that succeeds leaves the screen describing the new state', () => {
  // refresh() only re-reads /api/health: without a second GET of the plugin the header keeps
  // the state the POST just changed, and the Disable button stays live for a second POST.
  it('drops the Disable button once the refetched plugin says it is disabled', async () => {
    const calls: string[] = []
    serveThenReload(DORMANT, { ...DORMANT, enabled: false, state: 'disabled' }, calls)
    renderDetail()

    fireEvent.click(await screen.findByRole('button', { name: 'Disable' }))

    // The refetched state first: a waitFor on a null query passes instantly when the element
    // never rendered and hangs to its timeout otherwise, so it can fail for neither reason.
    expect(await screen.findByText('disabled')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Disable' })).toBeNull()
    expect(calls.filter((c) => c === 'GET /api/plugins/radarr')).toHaveLength(2)
  })

  it('re-reads the plugin after a germination retry, so a germinated one stops reading dormant', async () => {
    const calls: string[] = []
    serveThenReload(
      DORMANT,
      { ...DORMANT, state: 'germinated', reason: undefined, mounted: ['health.read'] },
      calls,
    )
    renderDetail(DEGRADED)

    fireEvent.click(await screen.findByRole('button', { name: 'Retry germination' }))

    await waitFor(() => { expect(screen.getByText('Germinated')).toBeDefined() })
    expect(screen.queryByText('Something it depends on is missing')).toBeNull()
    expect(screen.queryByText("requires rhiza 'plex', which is not installed")).toBeNull()
  })
})

describe('the commands tab of a plugin that declares none', () => {
  // 'Asks for nothing.' is DemandsList's sentence about scopes and dependencies; every hypha,
  // rhiza and inhibitor reaches this branch, and none of them asks for nothing.
  it('says it declares no command, not that it asks for nothing', async () => {
    serve(DETAIL)
    renderDetail()

    await waitFor(() => { expect(screen.getByText('radarr')).toBeDefined() })
    fireEvent.click(screen.getByRole('button', { name: /^Commands/ }))

    expect(screen.getByText('Declares no command.')).toBeDefined()
    expect(screen.queryByText('Asks for nothing.')).toBeNull()
  })
})
