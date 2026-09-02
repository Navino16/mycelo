import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { MemoryRouter } from 'react-router'
import { HealthContext } from '../../src/health.tsx'
import { I18nProvider } from '../../src/i18n.tsx'
import { Overview } from '../../src/screens/Overview.tsx'
import type { PluginGroups, RoleDto, RuntimeHealth, SourceDto } from '../../src/api/types.ts'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

const GERMINATED: RuntimeHealth = { mode: 'germinated', dormant: [], enforcingBlocked: [], rhizas: [] }

/** A setup with a source, a channel and a custom role — nothing left for GuidedStart to name. */
const COMPLETE_SOURCES: readonly SourceDto[] = [
  { id: 1, label: 'Registry', driver: 'github', location: 'x', official: true, enabled: true },
]
const COMPLETE_PLUGINS: PluginGroups = {
  hypha: [{ name: 'signal', kind: 'hypha', commands: [], state: 'germinated', enabled: true }],
  rhiza: [],
  enzyme: [],
  inhibitor: [],
  unknown: [],
}
const COMPLETE_ROLES: readonly RoleDto[] = [
  { name: 'owner', builtin: true, patterns: ['*'] },
  { name: 'guest', builtin: false, patterns: [] },
]

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

interface CountsFixture { sources: readonly SourceDto[], plugins: PluginGroups, roles: readonly RoleDto[] }

const COMPLETE: CountsFixture = { sources: COMPLETE_SOURCES, plugins: COMPLETE_PLUGINS, roles: COMPLETE_ROLES }

/** A stateful fake serving the three counts routes Overview.tsx reads, or a blanket failure. */
function mockCounts(fixture: CountsFixture | 'fail'): void {
  globalThis.fetch = mock((url: string) => {
    if (fixture === 'fail') return Promise.resolve(json({ error: { message: 'x' } }, 500))
    if (url === '/api/sources') return Promise.resolve(json(fixture.sources))
    if (url === '/api/plugins') return Promise.resolve(json(fixture.plugins))
    if (url === '/api/roles') return Promise.resolve(json(fixture.roles))
    return Promise.resolve(json({ error: { message: 'unhandled in test' } }, 404))
  }) as unknown as typeof fetch
}

/**
 * Flushes the counts fetch before the test ends: every test now triggers three GET requests
 * on mount, and letting them settle after teardown is what produced the act() warnings.
 */
async function withHealth(health: RuntimeHealth | null, counts: CountsFixture | 'fail' = COMPLETE): Promise<void> {
  mockCounts(counts)
  render(
    <I18nProvider>
      <HealthContext value={{ health, error: false, refresh: () => Promise.resolve() }}>
        <MemoryRouter><Overview /></MemoryRouter>
      </HealthContext>
    </I18nProvider>,
  )
  await act(() => Promise.resolve())
}

describe('the overview', () => {
  it('says everything is germinated when nothing is wrong', async () => {
    await withHealth(GERMINATED)
    expect(screen.getByText('Everything is germinated.')).toBeDefined()
  })

  // brief §5: the metaphor never replaces information — the reason travels with the name.
  it('names a dormant plugin beside its literal reason, never the word alone', async () => {
    await withHealth({ ...GERMINATED, dormant: [{ name: 'radarr', reason: 'apiKey: missing required field' }] })

    expect(screen.getByText('radarr')).toBeDefined()
    expect(screen.getByText('apiKey: missing required field')).toBeDefined()
    expect(screen.queryByText('Everything is germinated.')).toBeNull()
  })

  it('names every degraded rhiza, not just the first', async () => {
    await withHealth({
      ...GERMINATED,
      rhizas: [
        { rhiza: 'radarr', status: { state: 'healthy', checkedAt: '2026-01-01' } },
        { rhiza: 'plex', status: { state: 'unreachable', detail: 'connection refused', checkedAt: '2026-01-01' } },
        { rhiza: 'jellyfin', status: { state: 'degraded', detail: 'HTTP 502', checkedAt: '2026-01-01' } },
      ],
    })

    expect(screen.queryByText('radarr')).toBeNull()
    expect(screen.getByText('plex')).toBeDefined()
    expect(screen.getByText('connection refused')).toBeDefined()
    expect(screen.getByText('jellyfin')).toBeDefined()
    expect(screen.getByText('HTTP 502')).toBeDefined()
  })

  it('names the germination failure when the bot itself never finished starting', async () => {
    await withHealth({
      mode: 'degraded',
      dormant: [],
      enforcingBlocked: [],
      rhizas: [],
      failure: { kind: 'cycle', message: 'cycle: alpha -> beta -> alpha', spores: ['alpha', 'beta'] },
    })

    expect(screen.getByText('Germination failed')).toBeDefined()
    expect(screen.getByText('cycle: alpha -> beta -> alpha')).toBeDefined()
    // germination.ts leaves dormant/enforcingBlocked/rhizas all [] on every failure mode, so
    // this fixture is the one that actually distinguishes "gated on the three arrays" from
    // "gated on mode" — the bug the fix round found.
    expect(screen.queryByText('Everything is germinated.')).toBeNull()
  })

  // The exact CI reproduction (run 33601721469): '/api/health' answering '{}' crashed this
  // screen through React Router's error boundary. render() throws synchronously here if the
  // component crashes, so no error-boundary wiring is needed for this test to catch it.
  it('does not crash on a health payload it cannot read, and says so rather than claiming all is well', async () => {
    await withHealth({} as unknown as RuntimeHealth)

    expect(screen.getByText('The substrate answered a shape this screen does not understand (?)')).toBeDefined()
    expect(screen.queryByText('Everything is germinated.')).toBeNull()
  })

  // health.ts never sends this shape today, but a bare '!== undefined' let 'failure: null'
  // through to '.message' the same way the unguarded arrays let '{}' through to '.filter'.
  it('does not crash on a null failure in degraded mode', async () => {
    await withHealth({
      mode: 'degraded', dormant: [], enforcingBlocked: [], rhizas: [],
      failure: null as unknown as RuntimeHealth['failure'],
    })

    expect(screen.getByText('Overview')).toBeDefined()
    expect(screen.queryByText('Germination failed')).toBeNull()
  })
})

describe('the guided path out of an empty substrate', () => {
  it('renders the three steps and hides the tiles when nothing is configured yet', async () => {
    await withHealth(GERMINATED, { sources: [], plugins: { ...COMPLETE_PLUGINS, hypha: [] }, roles: [] })

    await waitFor(() => { expect(screen.getAllByRole('link')).toHaveLength(3) })
    expect(screen.getByText('Add a source')).toBeDefined()
    expect(screen.getByText('Install a channel')).toBeDefined()
    expect(screen.getByText('Create a role')).toBeDefined()
    // The tiles this screen otherwise renders are gone while a step is outstanding.
    expect(screen.queryByText('Everything is germinated.')).toBeNull()
  })

  it('renders exactly the two remaining steps once one of them is done', async () => {
    await withHealth(GERMINATED, { sources: COMPLETE_SOURCES, plugins: { ...COMPLETE_PLUGINS, hypha: [] }, roles: [] })

    await waitFor(() => { expect(screen.getAllByRole('link')).toHaveLength(2) })
    expect(screen.queryByText('Add a source')).toBeNull()
    expect(screen.getByText('Install a channel')).toBeDefined()
    expect(screen.getByText('Create a role')).toBeDefined()
  })

  it('says nothing is outstanding and shows the ordinary tiles once all three exist', async () => {
    await withHealth(GERMINATED, COMPLETE)

    await waitFor(() => { expect(screen.getByText('Everything is germinated.')).toBeDefined() })
    expect(screen.queryByText('Three moves to a working substrate')).toBeNull()
  })

  // Decision: an unreadable count is reported through its own alert, matching every other
  // screen's fetch-error shape — never a silent "all done" over a count nobody confirmed.
  it('reports a fetch failure of the three counts through its own alert, and keeps the tiles', async () => {
    await withHealth(GERMINATED, 'fail')

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Something went wrong')
    expect(screen.getByText('Everything is germinated.')).toBeDefined()
  })
})
