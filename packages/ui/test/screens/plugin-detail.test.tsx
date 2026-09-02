import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { MemoryRouter, Route, Routes } from 'react-router'
import { I18nProvider } from '../../src/i18n.tsx'
import { PluginDetail } from '../../src/screens/PluginDetail.tsx'
import type { PluginDetailDto } from '../../src/api/types.ts'

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

function renderDetail(): void {
  render(
    <I18nProvider>
      <MemoryRouter initialEntries={['/plugins/radarr']}>
        <Routes><Route path="/plugins/:name" element={<PluginDetail />} /></Routes>
      </MemoryRouter>
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

  it('shows what was declared and what germination granted, side by side', async () => {
    serve(DETAIL)
    renderDetail()

    await waitFor(() => { expect(screen.getByText('Declared in its manifest')).toBeDefined() })
    expect(screen.getByText('Granted at germination')).toBeDefined()
    // 'health.read' appears once as a sentence (declared) and once as a raw scope (mounted).
    expect(screen.getByText('See the health of connected systems')).toBeDefined()
    expect(screen.getByText('health.read')).toBeDefined()
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
