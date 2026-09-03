import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { MemoryRouter } from 'react-router'
import { ChromeContext } from '../../src/chrome.tsx'
import { diagnose } from '../../src/components/DormantDiagnosis.tsx'
import { TONE_CLASSES } from '../../src/components/tone.ts'
import { HealthContext } from '../../src/health.tsx'
import { I18nProvider } from '../../src/i18n.tsx'
import { Overview } from '../../src/screens/Overview.tsx'
import type { ChromeValue } from '../../src/chrome.tsx'
import type {
  CommandGroups, ConfigDto, PluginGroups, RoleDto, RuntimeHealth, SourceDto, SubstrateDto,
} from '../../src/api/types.ts'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

const GERMINATED: RuntimeHealth = {
  mode: 'germinated', dormant: [], enforcingBlocked: [], rhizas: [], blockedSinceBoot: 0,
}

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

/**
 * Two germinated, two dormant, one disabled, and three commands declared by plugins that did
 * not start: the fixture the health card, the tiles and the search all read from.
 */
const BUSY_PLUGINS: PluginGroups = {
  hypha: [{ name: 'signal', kind: 'hypha', commands: [], state: 'germinated', enabled: true }],
  rhiza: [{
    name: 'radarr', kind: 'rhiza', commands: [], state: 'dormant', enabled: true,
    reason: 'Configuration rejected: api_key returned 401 Unauthorized.',
  }],
  enzyme: [
    { name: 'search', kind: 'enzyme', commands: ['find', 'grab'], state: 'germinated', enabled: true },
    {
      name: 'radarr-search', kind: 'enzyme', commands: ['movie', 'queue', 'wanted'],
      state: 'dormant', enabled: true, reason: 'Requires rhiza-radarr >=2.0.0; installed 1.8.4.',
    },
  ],
  inhibitor: [{ name: 'quiet-hours', kind: 'inhibitor', commands: [], state: 'disabled', enabled: false }],
  unknown: [],
}

const BUSY_COMMANDS: CommandGroups = {
  search: [
    { plugin: 'search', command: 'find', declared: 'find', qualified: 'search.find', description: '', capabilities: [] },
    { plugin: 'search', command: 'grab', declared: 'grab', qualified: 'search.grab', description: '', capabilities: [] },
  ],
}

const SUBSTRATE: SubstrateDto = {
  version: '0.9.3', startedAt: '2026-01-01T00:00:00.000Z', uptimeSeconds: 14 * 86_400 + 3 * 3_600,
}

/** One attention row, so a degradation test can watch that section survive on its own. */
const ONE_DORMANT: RuntimeHealth = {
  ...GERMINATED,
  dormant: [{ name: 'radarr', reason: 'Configuration rejected: api_key returned 401.' }],
}

/** The Overview reads only `substrate` off the chrome; the counts belong to the sidebar. */
const CHROME: ChromeValue = { substrate: SUBSTRATE, counts: null, host: 'substrate.home.lan' }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function page(total: number): unknown {
  return { items: [], page: 1, perPage: 1, total }
}

interface CountsFixture {
  sources: readonly SourceDto[]
  plugins: PluginGroups
  roles: readonly RoleDto[]
  commands?: CommandGroups
  config?: ConfigDto
  people?: number
  neverReviewed?: number
  /** Routes this fixture answers 500 to, the rest answering normally. */
  refuse?: readonly string[]
}

const COMPLETE: CountsFixture = { sources: COMPLETE_SOURCES, plugins: COMPLETE_PLUGINS, roles: COMPLETE_ROLES }

const BUSY: CountsFixture = {
  sources: COMPLETE_SOURCES,
  plugins: BUSY_PLUGINS,
  roles: COMPLETE_ROLES,
  commands: BUSY_COMMANDS,
  config: { prefix: '!', defaultLocale: 'en', defaultRole: 'guest' },
  people: 128,
  neverReviewed: 14,
}

/** A stateful fake serving every route Overview.tsx reads, or a blanket failure. */
function mockCounts(fixture: CountsFixture | 'fail'): void {
  globalThis.fetch = mock((url: string) => {
    if (fixture === 'fail') return Promise.resolve(json({ error: { message: 'x' } }, 500))
    if (fixture.refuse?.includes(url) === true) {
      return Promise.resolve(json({ error: { message: 'refused' } }, 500))
    }
    if (url === '/api/sources') return Promise.resolve(json(fixture.sources))
    if (url === '/api/plugins') return Promise.resolve(json(fixture.plugins))
    if (url === '/api/roles') return Promise.resolve(json(fixture.roles))
    if (url === '/api/commands') return Promise.resolve(json(fixture.commands ?? {}))
    if (url === '/api/config') {
      return Promise.resolve(json(fixture.config ?? { prefix: '!', defaultLocale: 'en' }))
    }
    if (url === '/api/people?perPage=1') return Promise.resolve(json(page(fixture.people ?? 0)))
    if (url === '/api/people?reviewed=false&perPage=1') {
      return Promise.resolve(json(page(fixture.neverReviewed ?? 0)))
    }
    if (url === '/api/substrate') return Promise.resolve(json(SUBSTRATE))
    return Promise.resolve(json({ error: { message: 'unhandled in test' } }, 404))
  }) as unknown as typeof fetch
}

interface Options { error?: boolean, refresh?: () => Promise<void> }

function renderOverview(
  health: RuntimeHealth | null, options: Options = {}, chrome: ChromeValue = CHROME,
): HTMLElement {
  const { container } = render(
    <I18nProvider>
      <HealthContext
        value={{
          health,
          error: options.error ?? false,
          refresh: options.refresh ?? (() => Promise.resolve()),
        }}
      >
        <ChromeContext value={chrome}>
          <MemoryRouter><Overview /></MemoryRouter>
        </ChromeContext>
      </HealthContext>
    </I18nProvider>,
  )
  return container
}

/**
 * Flushes the counts fetch before the test ends: every test triggers seven GET requests on
 * mount, and letting them settle after teardown is what produced the act() warnings.
 * ChromeContext rather than ChromeProvider: the Overview reads the substrate and never
 * fetches it, and the provider would only add its own four requests with nothing to assert.
 */
async function withHealth(
  health: RuntimeHealth | null, counts: CountsFixture | 'fail' = COMPLETE, options: Options = {},
): Promise<HTMLElement> {
  mockCounts(counts)
  const container = renderOverview(health, options)
  await act(() => Promise.resolve())
  return container
}

/** The section a heading introduces, for a query that must not reach the rest of the page. */
function sectionOf(name: string | RegExp): HTMLElement {
  const section = screen.getByRole('heading', { name }).closest('section')
  if (section === null) throw new Error(`no section around ${String(name)}`)
  return section
}

function fetchedUrls(): readonly string[] {
  const calls = (globalThis.fetch as unknown as { mock: { calls: [string][] } }).mock.calls
  return calls.map(([url]) => url)
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
      blockedSinceBoot: 0,
      failure: { kind: 'cycle', message: 'cycle: alpha -> beta -> alpha', spores: ['alpha', 'beta'] },
    })

    expect(screen.getByText('Germination failed')).toBeDefined()
    expect(screen.getByText('cycle: alpha -> beta -> alpha')).toBeDefined()
    // germination.ts leaves dormant/enforcingBlocked/rhizas all [] on every failure mode, so
    // this fixture is the one that actually distinguishes "gated on the three arrays" from
    // "gated on mode" — the bug the fix round found.
    expect(screen.queryByText('Everything is germinated.')).toBeNull()
  })

  // R1: crit belongs to the mute bot alone, so a failed germination — bad as it is — is amber.
  it('paints the germination failure amber, never the mute red', async () => {
    const container = await withHealth({
      mode: 'degraded', dormant: [], enforcingBlocked: [], rhizas: [], blockedSinceBoot: 0,
      failure: { kind: 'unknown', message: 'boot threw' },
    })
    const card = container.querySelector('[data-testid="germination-failure"]')

    expect(card?.className).toContain(TONE_CLASSES.warn.bg)
    expect(card?.className).not.toContain(TONE_CLASSES.crit.bg)
  })

  // The exact CI reproduction (run 33601721469): '/api/health' answering '{}' crashed this
  // screen through React Router's error boundary. render() throws synchronously here if the
  // component crashes, so no error-boundary wiring is needed for this test to catch it.
  it('does not crash on a health payload it cannot read, and says so rather than claiming all is well', async () => {
    await withHealth({} as unknown as RuntimeHealth)

    expect(screen.getByText('The substrate answered a shape this screen does not understand (?)')).toBeDefined()
    expect(screen.queryByText('Everything is germinated.')).toBeNull()
  })

  // Discriminates allWell's own '!unreadable' term from the mode check alone: mode is
  // 'germinated' but rhizas is missing, so the unreadable alert and "all well" must not
  // both claim the operator's attention at once.
  it('does not say all is well on a germinated-but-unreadable shape', async () => {
    await withHealth(
      { mode: 'germinated', dormant: [], enforcingBlocked: [] } as unknown as RuntimeHealth,
    )

    expect(screen.getByText('The substrate answered a shape this screen does not understand (?)')).toBeDefined()
    expect(screen.queryByText('Everything is germinated.')).toBeNull()
  })

  // health.ts never sends this shape today, but a bare '!== undefined' let 'failure: null'
  // through to '.message' the same way the unguarded arrays let '{}' through to '.filter'.
  it('does not crash on a null failure in degraded mode', async () => {
    await withHealth({
      mode: 'degraded', dormant: [], enforcingBlocked: [], rhizas: [], blockedSinceBoot: 0,
      failure: null as unknown as RuntimeHealth['failure'],
    })

    expect(screen.getByText('Overview')).toBeDefined()
    expect(screen.queryByText('Germination failed')).toBeNull()
  })
})

// The four causes CriticalBanner used to own. healthPillState decides them (task 15); this
// screen is now the only surface that renders them.
describe('the health of the substrate, as this screen reports it', () => {
  it('says the substrate is not answering when the poll failed', async () => {
    await withHealth(null, COMPLETE, { error: true })

    expect(screen.getByRole('alert').textContent).toContain('The substrate is not answering')
    expect(screen.queryByText('The bot is answering nobody')).toBeNull()
  })

  // Absent is not empty: a payload that never said whether traffic is blocked must say so in
  // those words, or a mute bot reads as one more odd shape.
  it('says it cannot tell whether traffic is blocked, when enforcingBlocked is not an array', async () => {
    await withHealth({ ...GERMINATED, enforcingBlocked: { oops: true } as unknown as string[] })

    expect(screen.getByText('The substrate did not report whether traffic is blocked (?)')).toBeDefined()
    expect(screen.queryByText('The bot is answering nobody')).toBeNull()
  })

  // Discriminates that line from the general unreadable alert: enforcingBlocked is readable
  // here, so nothing may claim the bot's traffic state is unknown.
  it('does not claim the traffic state is unknown when only rhizas is unreadable', async () => {
    await withHealth({ ...GERMINATED, rhizas: undefined as unknown as [] })

    expect(screen.getByText('The substrate answered a shape this screen does not understand (?)')).toBeDefined()
    expect(screen.queryByText('The substrate did not report whether traffic is blocked (?)')).toBeNull()
  })
})

describe('the mute takeover', () => {
  // design note 1a: the critical state "does not merely re-colour the pill: it replaces the
  // page body". A banner above an unchanged body — what the SPA shipped — fails here.
  it('replaces the whole overview body while the bot is mute', async () => {
    await withHealth({
      ...GERMINATED,
      enforcingBlocked: ['group-gate'],
      dormant: [{ name: 'radarr', reason: 'apiKey: missing required field' }],
      blockedSinceBoot: 41,
    }, BUSY)

    const heading = screen.getByRole('heading', { name: 'The bot is answering nobody' })
    // The name is interpolated inside health.blocked.body's own sentence, which is the
    // paragraph under the heading — not only inside the `Disable <name>` button.
    expect(heading.nextElementSibling?.textContent).toContain('group-gate')
    expect(screen.getByText('41')).toBeDefined()
    // The body, gone — not merely pushed down.
    expect(screen.queryByText('Everything is germinated.')).toBeNull()
    expect(screen.queryByText('apiKey: missing required field')).toBeNull()
    expect(screen.queryByText('People')).toBeNull()
    expect(screen.queryByText('of 5 plugins germinated')).toBeNull()
    expect(screen.queryByLabelText('Search plugins, people, commands')).toBeNull()
  })

  // The takeover is the *mute* condition's alone: a degraded substrate still has numbers
  // worth reading, and hiding them would make journey D unusable on an ordinary bad day.
  it('keeps the body for a merely degraded substrate', async () => {
    await withHealth({ ...GERMINATED, dormant: [{ name: 'radarr', reason: 'apiKey: missing' }] })

    expect(screen.queryByText('The bot is answering nobody')).toBeNull()
    expect(screen.getByText('radarr')).toBeDefined()
  })

  // CriticalBanner's guard, kept: an unreadable payload must not read as a working bot, and
  // must not silently take the body over either.
  it('reports an unreadable payload without taking the body over', async () => {
    await withHealth({ ...GERMINATED, enforcingBlocked: undefined as unknown as string[] })

    expect(screen.getByText('The substrate answered a shape this screen does not understand (?)')).toBeDefined()
    expect(screen.queryByText('The bot is answering nobody')).toBeNull()
  })

  // The distinction design §12 calls silent-when-wrong: one name and two must differ.
  it('names every blocked inhibitor, not just the first', async () => {
    await withHealth({ ...GERMINATED, enforcingBlocked: ['group-gate', 'house-rules'], blockedSinceBoot: 3 })

    expect(screen.getByRole('alert').textContent).toContain('group-gate')
    expect(screen.getByRole('alert').textContent).toContain('house-rules')
  })

  // 2j's own note calls the count "the number that matters"; blockedSinceBoot is a count, so
  // this is the one measured consequence the takeover can show.
  it('shows how many messages were refused, labelled', async () => {
    await withHealth({ ...GERMINATED, enforcingBlocked: ['group-gate'], blockedSinceBoot: 41 })

    expect(screen.getByText('Messages dropped')).toBeDefined()
    expect(screen.getByText('41')).toBeDefined()
  })

  // I12: `Messages dropped 0` for a counter the payload never carried reads as an affirmative
  // "nothing was dropped", on the one screen the design says makes every other number
  // irrelevant. The label goes with the number.
  it('withholds the dropped count when the payload carries none, rather than printing 0', async () => {
    await withHealth({
      ...GERMINATED,
      enforcingBlocked: ['group-gate'],
      blockedSinceBoot: undefined as unknown as number,
    })
    const takeover = screen.getByRole('alert')

    expect(within(takeover).getByText('The bot is answering nobody')).toBeDefined()
    expect(within(takeover).queryByText('Messages dropped')).toBeNull()
    expect(within(takeover).queryByText('0')).toBeNull()
  })

  // Discriminates withholding from hiding the block: a confirmed zero is a fact and prints.
  it('prints a confirmed zero, which is not the same as a counter it could not read', async () => {
    await withHealth({ ...GERMINATED, enforcingBlocked: ['group-gate'], blockedSinceBoot: 0 })
    const takeover = screen.getByRole('alert')

    expect(within(takeover).getByText('Messages dropped')).toBeDefined()
    expect(within(takeover).getByText('0')).toBeDefined()
  })

  // §2 1c: POST /api/plugins/:name/disable is mounted and had no caller until this screen.
  it('disables the first blocked inhibitor and re-reads the health', async () => {
    let refreshed = 0
    mockCounts(COMPLETE)
    const inner = globalThis.fetch as unknown as (u: string, i?: RequestInit) => Promise<Response>
    globalThis.fetch = mock((url: string, init?: RequestInit) => (
      url === '/api/plugins/group-gate/disable'
        ? Promise.resolve(json({ ok: true, restartRequired: true }))
        : inner(url, init)
    )) as unknown as typeof fetch

    renderOverview(
      { ...GERMINATED, enforcingBlocked: ['group-gate'], blockedSinceBoot: 2 },
      { refresh: () => { refreshed += 1; return Promise.resolve() } },
    )
    await act(() => Promise.resolve())

    fireEvent.click(screen.getByRole('button', { name: /^Disable group-gate/ }))

    await waitFor(() => { expect(refreshed).toBe(1) })
    expect(fetchedUrls()).toContain('/api/plugins/group-gate/disable')
  })

  it('reports a refused disable rather than looking as though it worked', async () => {
    mockCounts(COMPLETE)
    const inner = globalThis.fetch as unknown as (u: string, i?: RequestInit) => Promise<Response>
    globalThis.fetch = mock((url: string, init?: RequestInit) => (
      url === '/api/plugins/group-gate/disable'
        ? Promise.resolve(json({ error: { message: 'the substrate refused' } }, 409))
        : inner(url, init)
    )) as unknown as typeof fetch

    renderOverview({ ...GERMINATED, enforcingBlocked: ['group-gate'], blockedSinceBoot: 2 })
    await act(() => Promise.resolve())

    fireEvent.click(screen.getByRole('button', { name: /^Disable group-gate/ }))

    expect(await screen.findByText('the substrate refused')).toBeDefined()
  })

  // Both mute renders keep the substrate's three numbers under the takeover, collapsed:
  // `2j` calls it "Everything else, unchanged", `1a-mobile` "Everything below is secondary".
  it('keeps the substrate numbers collapsed under the takeover', async () => {
    await withHealth({
      ...GERMINATED,
      enforcingBlocked: ['group-gate'],
      blockedSinceBoot: 41,
      rhizas: [{ rhiza: 'jellyfin', status: { state: 'unreachable', checkedAt: 'x' } }],
    }, BUSY)

    expect(screen.getByText('Everything below is secondary while the bot is mute.')).toBeDefined()
    expect(screen.getByText('2 / 5 germinated')).toBeDefined()
    expect(screen.getByText('2 dormant')).toBeDefined()
    expect(screen.getByText('1 systems down')).toBeDefined()
    // Numbers, not the body: the R2 pin still holds around them.
    expect(screen.queryByText('People')).toBeNull()
    expect(screen.queryByText('of 5 plugins germinated')).toBeNull()
  })

  it('shows no collapsed card while the bot is answering', async () => {
    await withHealth(GERMINATED, BUSY)

    expect(screen.queryByText('Everything below is secondary while the bot is mute.')).toBeNull()
    expect(screen.queryByText('2 / 5 germinated')).toBeNull()
  })

  // Finding 7: the route answers { ok, restartRequired }, and a disable that changed nothing
  // visible until the next restart must say so.
  it('says a restart is awaited once the disable is accepted', async () => {
    mockCounts(COMPLETE)
    const inner = globalThis.fetch as unknown as (u: string, i?: RequestInit) => Promise<Response>
    globalThis.fetch = mock((url: string, init?: RequestInit) => (
      url === '/api/plugins/group-gate/disable'
        ? Promise.resolve(json({ ok: true, restartRequired: true }))
        : inner(url, init)
    )) as unknown as typeof fetch

    renderOverview({ ...GERMINATED, enforcingBlocked: ['group-gate'], blockedSinceBoot: 2 })
    await act(() => Promise.resolve())

    expect(screen.queryByText('Awaiting restart')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /^Disable group-gate/ }))

    expect(await screen.findByText('Awaiting restart')).toBeDefined()
  })

  // A ref, not the `busy` state: two clicks in one tick read the same render, and the second
  // POST would hit a substrate already mid-restart.
  it('sends one disable, not two, when clicked twice in flight', async () => {
    mockCounts(COMPLETE)
    let resolveDisable: (r: Response) => void = () => {}
    const held = new Promise<Response>((resolve) => { resolveDisable = resolve })
    const inner = globalThis.fetch as unknown as (u: string, i?: RequestInit) => Promise<Response>
    globalThis.fetch = mock((url: string, init?: RequestInit) => (
      url === '/api/plugins/group-gate/disable' ? held : inner(url, init)
    )) as unknown as typeof fetch

    renderOverview({ ...GERMINATED, enforcingBlocked: ['group-gate'], blockedSinceBoot: 2 })
    await act(() => Promise.resolve())

    const button = screen.getByRole('button', { name: /^Disable group-gate/ })
    fireEvent.click(button)
    fireEvent.click(button)

    const posts = fetchedUrls().filter((url) => url === '/api/plugins/group-gate/disable')
    expect(posts).toHaveLength(1)

    await act(async () => {
      resolveDisable(json({ ok: true, restartRequired: true }))
      await new Promise((resolve) => { setTimeout(resolve, 0) })
    })
  })

  // R1: mute is the one red state in the whole SPA, and the takeover is where it is spent.
  it('is the one surface painted crit', async () => {
    await withHealth({ ...GERMINATED, enforcingBlocked: ['group-gate'], blockedSinceBoot: 1 })

    expect(screen.getByRole('alert').className).toContain(TONE_CLASSES.crit.bg)
  })
})

describe('the substrate health card', () => {
  it('counts the germinated against the installed, and draws one segment per state', async () => {
    const container = await withHealth(GERMINATED, BUSY)
    const card = sectionOf('Substrate health')

    expect(within(card).getByText('of 5 plugins germinated')).toBeDefined()
    expect(within(card).getByTestId('germinated-count').textContent).toBe('2')
    const segments = [...container.querySelectorAll('[data-segment]')]
      .map((s) => [s.getAttribute('data-segment'), (s as HTMLElement).style.width])

    expect(segments).toEqual([['Germinated', '40%'], ['Dormant', '40%'], ['Disabled', '20%']])
  })

  // 1a-overview-mobile-healthy-light.png draws two legend entries for a substrate with no
  // dormant plugin: a `Dormant 0` row is noise the design does not print.
  it('leaves out a legend entry no plugin is in', async () => {
    await withHealth(GERMINATED, COMPLETE)
    const card = sectionOf('Substrate health')

    expect(card.querySelector('[data-legend="Germinated"]')).not.toBeNull()
    expect(card.querySelector('[data-legend="Dormant"]')).toBeNull()
    expect(card.querySelector('[data-legend="Disabled"]')).toBeNull()
  })

  // 1a draws `Systems down 2` beside the plugin states: a rhiza that stopped answering is not
  // a plugin state, so it is a legend entry and never a bar segment.
  it('names the connected systems that are down beside the plugin states', async () => {
    const container = await withHealth({
      ...GERMINATED,
      rhizas: [
        { rhiza: 'plex', status: { state: 'unreachable', checkedAt: '2026-01-01' } },
        { rhiza: 'jellyfin', status: { state: 'degraded', checkedAt: '2026-01-01' } },
      ],
    }, BUSY)
    const card = sectionOf('Substrate health')

    expect(card.querySelector('[data-legend="Systems down"]')?.textContent).toBe('Systems down2')
    expect([...container.querySelectorAll('[data-segment]')].map((s) => s.getAttribute('data-segment')))
      .not.toContain('Systems down')
  })
})

describe('the four tiles', () => {
  it('reads each count off the route that answers it, with the note the design prints', async () => {
    await withHealth(GERMINATED, BUSY)

    expect(screen.getByText('People')).toBeDefined()
    expect(screen.getByText('128')).toBeDefined()
    expect(screen.getByText('14 never reviewed')).toBeDefined()
    expect(screen.getByText('Commands')).toBeDefined()
    // Three commands are declared by the two plugins that did not start (task 14 fills
    // PluginDto.commands for a dormant enzyme); /api/commands lists only the two that work.
    expect(screen.getByText('3 unavailable')).toBeDefined()
    expect(screen.getByText('Roles')).toBeDefined()
    expect(screen.getByText('default: guest')).toBeDefined()
    expect(screen.getByText('Sources')).toBeDefined()
  })

  // Discriminates a missing defaultRole from an empty one: /api/config omits the key entirely
  // when no role is configured, and `default: undefined` is worse than saying there is none.
  it('says there is no default role rather than printing one that does not exist', async () => {
    await withHealth(GERMINATED, { ...BUSY, config: { prefix: '!', defaultLocale: 'en' } })

    expect(screen.getByText('no default role')).toBeDefined()
    expect(screen.queryByText(/^default:/)).toBeNull()
  })

  // Discriminates the note's own `> 0` guard: `0 unavailable` is noise on a substrate where
  // every command works, and the artboard prints the note only when there is a number to print.
  it('prints no unavailable note when every command answers', async () => {
    await withHealth(GERMINATED, COMPLETE)

    expect(screen.getByText('Commands')).toBeDefined()
    expect(screen.queryByText(/unavailable/)).toBeNull()
    expect(screen.queryByText(/never reviewed/)).toBeNull()
  })

  // The `1 unreachable` note on the Sources tile is dropped for want of a probe route (§3 row
  // 9): a tile that invents a number is worse than a tile that prints none.
  it('prints no note on the sources tile', async () => {
    await withHealth(GERMINATED, BUSY)
    const tile = screen.getByText('Sources').closest('div')

    expect(tile?.textContent).toBe('Sources1')
  })
})

describe('what needs attention', () => {
  const BUSY_HEALTH: RuntimeHealth = {
    ...GERMINATED,
    dormant: [
      { name: 'radarr', reason: 'Configuration rejected: api_key returned 401 Unauthorized.' },
      { name: 'radarr-search', reason: 'Requires rhiza-radarr >=2.0.0; installed 1.8.4.' },
    ],
    rhizas: [
      { rhiza: 'jellyfin', status: { state: 'unreachable', detail: 'No answer at 10.0.0.14:8096', checkedAt: 'x' } },
    ],
  }

  function rows(): number {
    return within(sectionOf(/^Needs attention/)).getAllByRole('listitem').length
  }

  it('counts every row in its heading and names the kind of each', async () => {
    await withHealth(BUSY_HEALTH, BUSY)

    expect(screen.getByRole('heading', { name: 'Needs attention · 3' })).toBeDefined()
    // 1a-desktop heads the table; the SINCE column is dropped with the dormancy ages (§3 row 6).
    expect(screen.getByText('Reason')).toBeDefined()
    expect(screen.queryByText('Since')).toBeNull()
    // The kind comes from /api/plugins; health.dormant does not carry one. Two rows are rhizas
    // — the dormant connector and the silent one — and one is the enzyme that depends on it.
    // I3: the catalogue's plural term, not the wire value — brief §6 fixes the vocabulary as
    // `Rhizae · connected systems`, and this table printed the lowercase singular.
    expect(screen.getAllByText('Rhizae \u00b7 connected systems')).toHaveLength(2)
    expect(screen.getByText('Enzymes \u00b7 commands')).toBeDefined()
  })

  it('says how long ago the substrate was last read', async () => {
    await withHealth(BUSY_HEALTH, BUSY)

    expect(screen.getByText(/^checked \d+s ago$/)).toBeDefined()
  })

  // The two filters are the design's own split: dormant plugins on one side, connected
  // systems that stopped answering on the other.
  it('narrows the rows to the dormant plugins, then to the systems, then back', async () => {
    await withHealth(BUSY_HEALTH, BUSY)

    expect(rows()).toBe(3)

    fireEvent.click(screen.getByRole('button', { name: /^Dormant/ }))

    expect(rows()).toBe(2)
    expect(screen.queryByText('jellyfin')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /^Unreachable/ }))

    expect(rows()).toBe(1)
    expect(screen.getByText('jellyfin')).toBeDefined()
    expect(screen.queryByText('radarr')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'All' }))

    expect(rows()).toBe(3)
  })

  /**
   * I5: two clicks reach this — a substrate whose only faults are dormant plugins, and the
   * `Unreachable` chip. The old code rendered the bordered card and its column headers over
   * nothing, and no chip returned to `all`.
   */
  it('never renders the table headed and empty when the chosen filter matches no row', async () => {
    await withHealth({
      ...GERMINATED,
      dormant: [{ name: 'radarr', reason: 'Configuration rejected.' }],
    }, BUSY)

    fireEvent.click(screen.getByRole('button', { name: /^Unreachable/ }))

    expect(rows()).toBe(1)
    expect(screen.getByText('radarr')).toBeDefined()
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /^Unreachable/ }).getAttribute('aria-pressed')).toBe('false')
  })

  // Discriminates the fallback from a filter that never worked: with rows on both sides the
  // selection is honoured.
  it('keeps a filter the rows do satisfy', async () => {
    await withHealth(BUSY_HEALTH, BUSY)

    fireEvent.click(screen.getByRole('button', { name: /^Unreachable/ }))

    expect(rows()).toBe(1)
    expect(screen.getByRole('button', { name: /^Unreachable/ }).getAttribute('aria-pressed')).toBe('true')
  })

  it('counts each filter, so a chip says how many rows it would keep', async () => {
    await withHealth(BUSY_HEALTH, BUSY)

    expect(screen.getByRole('button', { name: /^Dormant/ }).textContent).toBe('Dormant2')
    expect(screen.getByRole('button', { name: /^Unreachable/ }).textContent).toBe('Unreachable1')
  })

  // §3: `Fix api_key` is the one row action that exists — every other one in the artboard
  // needs a route that does not. It appears on the configuration cause and nowhere else.
  it('offers the settings link on a refused configuration and on nothing else', async () => {
    await withHealth(BUSY_HEALTH, BUSY)

    expect(screen.getByRole('link', { name: 'Fix its settings' }).getAttribute('href'))
      .toBe('/plugins/radarr/settings')
    expect(screen.getAllByRole('link', { name: 'Fix its settings' })).toHaveLength(1)
  })

  // Finding 5: one classifier for the whole SPA. DormantDiagnosis's config bucket carries the
  // settings action; its version bucket carries none, and the row must follow it either way.
  it('takes each row action from DormantDiagnosis, bucket for bucket', async () => {
    const config = 'Configuration rejected: api_key returned 401.'
    const version = 'Strain 0.6.2 requires core >=1.0.0; this substrate runs 0.9.3.'
    expect(diagnose('radarr', config).action?.label).toBe('dormant.fixConfig')
    expect(diagnose('matrix', version).action).toBeUndefined()

    await withHealth({
      ...GERMINATED,
      dormant: [{ name: 'radarr', reason: config }, { name: 'matrix', reason: version }],
    }, BUSY)

    expect(screen.getByRole('link', { name: 'Fix its settings' }).getAttribute('href'))
      .toBe('/plugins/radarr/settings')
    expect(screen.getAllByRole('link', { name: 'Fix its settings' })).toHaveLength(1)
  })

  it('offers a re-read of the health when nothing needs attention', async () => {
    let refreshed = 0
    await withHealth(GERMINATED, COMPLETE, { refresh: () => { refreshed += 1; return Promise.resolve() } })

    expect(screen.getByText('Every plugin germinated and every connected system answered. Nothing is waiting on you.'))
      .toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Re-run checks' }))

    await waitFor(() => { expect(refreshed).toBe(1) })
  })
})

describe('the page title block', () => {
  // Task 15's ruling: the shell header carries the pill and the two controls, so 1a's title
  // and its uptime line are this screen's own.
  it('carries both the mobile title and the desktop one, and the uptime line under them', async () => {
    await withHealth(GERMINATED)

    expect(screen.getByText('Substrate')).toBeDefined()
    expect(screen.getByText('Overview')).toBeDefined()
    expect(screen.getByText('mycelo 0.9.3 · up 14d 03h')).toBeDefined()
  })

  // 1a-desktop's title row is title + search: the line belongs to Nav's sidebar foot there,
  // and without md:hidden the desktop draws it twice.
  it('hides its uptime line on desktop, where the sidebar foot draws it', async () => {
    await withHealth(GERMINATED)

    expect(screen.getByText('mycelo 0.9.3 · up 14d 03h').className).toContain('md:hidden')
  })

  // useUptimeLine answers null for an unreadable uptime; `up 0s` is indistinguishable from a
  // fresh boot, so the line is absent rather than wrong.
  it('prints no uptime line when the substrate never answered', async () => {
    mockCounts(COMPLETE)
    renderOverview(GERMINATED, {}, { substrate: null, counts: null, host: '' })
    await act(() => Promise.resolve())

    expect(screen.queryByText(/mycelo/)).toBeNull()
    expect(screen.getByText('Overview')).toBeDefined()
  })
})

describe('the cross-entity search', () => {
  function type(term: string): void {
    fireEvent.change(screen.getByLabelText('Search plugins, people, commands'), { target: { value: term } })
  }

  it('matches an installed plugin by substring and links to it', async () => {
    await withHealth(GERMINATED, BUSY)

    type('radarr')
    const hits = screen.getByTestId('search-hits')

    expect(within(hits).getByRole('link', { name: 'radarr' }).getAttribute('href')).toBe('/plugins/radarr')
    expect(within(hits).getByRole('link', { name: 'radarr-search' })).toBeDefined()
    expect(within(hits).queryByRole('link', { name: 'signal' })).toBeNull()
  })

  it('matches a command by its qualified name and links to the plugin that declares it', async () => {
    await withHealth(GERMINATED, BUSY)

    type('grab')
    const hits = screen.getByTestId('search-hits')

    expect(within(hits).getByRole('link', { name: 'search.grab' }).getAttribute('href')).toBe('/plugins/search')
  })

  // §3 row 19: the search is a client filter over what this screen already holds, and people
  // are not in it — so the people group hands the term to the screen that can search them.
  it('hands a term off to the people screen rather than searching people itself', async () => {
    await withHealth(GERMINATED, BUSY)
    const before = fetchedUrls().length

    type('nobody')
    const hits = screen.getByTestId('search-hits')

    expect(within(hits).getByRole('link', { name: /nobody/ }).getAttribute('href')).toBe('/people?q=nobody')
    expect(fetchedUrls().slice(before)).toEqual([])
  })

  // §3 row 19 caps each group: a substring that matches thirty plugins would otherwise push
  // the whole page down, and the screen that owns them can show them all.
  it('caps a group at eight rows and links to the screen that owns the rest', async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      name: `radarr-${String(i)}`, kind: 'rhiza' as const, commands: [],
      state: 'germinated' as const, enabled: true,
    }))
    await withHealth(GERMINATED, { ...BUSY, plugins: { ...BUSY_PLUGINS, rhiza: many } })

    type('radarr-')
    const hits = screen.getByTestId('search-hits')

    expect(within(hits).getAllByRole('link', { name: /^radarr-/ })).toHaveLength(8)
    expect(within(hits).getByRole('link', { name: 'See all' }).getAttribute('href')).toBe('/plugins')
  })

  it('says nothing matches rather than showing an empty list', async () => {
    await withHealth(GERMINATED, BUSY)

    type('zzz')

    expect(screen.getByText('Nothing matches that')).toBeDefined()
  })

  it('shows nothing at all until something is typed', async () => {
    await withHealth(GERMINATED, BUSY)

    expect(screen.queryByTestId('search-hits')).toBeNull()
  })
})

describe('the guided path out of an empty substrate', () => {
  it('renders the three steps alongside the health body when nothing is configured yet', async () => {
    await withHealth(GERMINATED, { sources: [], plugins: { ...COMPLETE_PLUGINS, hypha: [] }, roles: [] })

    await waitFor(() => { expect(screen.getAllByRole('link')).toHaveLength(3) })
    expect(screen.getByText('Add a source')).toBeDefined()
    expect(screen.getByText('Install a channel')).toBeDefined()
    expect(screen.getByText('Create a role')).toBeDefined()
    // With nothing dormant and germination healthy, the ordinary tiles render too.
    expect(screen.getByText('Everything is germinated.')).toBeDefined()
  })

  // brief item 2: a fresh substrate stays in the guided state exactly while its first spores
  // are installed and go dormant — the operator must see both, not one hiding the other.
  it('renders the guided start above the dormant reason, not instead of it', async () => {
    await withHealth(
      { ...GERMINATED, dormant: [{ name: 'radarr', reason: 'apiKey: missing required field' }] },
      { sources: [], plugins: { ...COMPLETE_PLUGINS, hypha: [] }, roles: [] },
    )

    expect(await screen.findByText('Nothing is installed yet')).toBeDefined()
    expect(screen.getByText('radarr')).toBeDefined()
    expect(screen.getByText('apiKey: missing required field')).toBeDefined()
  })

  it('renders exactly the two remaining steps once one of them is done', async () => {
    await withHealth(GERMINATED, { sources: COMPLETE_SOURCES, plugins: { ...COMPLETE_PLUGINS, hypha: [] }, roles: [] })

    await waitFor(() => { expect(screen.getAllByRole('link')).toHaveLength(2) })
    expect(screen.queryByText('Add a source')).toBeNull()
    expect(screen.getByText('Install a channel')).toBeDefined()
    expect(screen.getByText('Create a role')).toBeDefined()
  })

  // Discriminates counting non-builtin roles from counting builtin ones: two builtin roles and
  // no custom one must still read as "no role created yet", not as two roles done.
  it('still asks for a role when only builtin roles exist', async () => {
    await withHealth(GERMINATED, {
      sources: COMPLETE_SOURCES,
      plugins: COMPLETE_PLUGINS,
      roles: [{ name: 'owner', builtin: true, patterns: ['*'] }, { name: 'admin', builtin: true, patterns: [] }],
    })

    expect(await screen.findByText('Create a role')).toBeDefined()
    expect(screen.queryByText('Add a source')).toBeNull()
    expect(screen.queryByText('Install a channel')).toBeNull()
  })

  it('says nothing is outstanding and shows the ordinary tiles once all three exist', async () => {
    await withHealth(GERMINATED, COMPLETE)

    await waitFor(() => { expect(screen.getByText('Everything is germinated.')).toBeDefined() })
    expect(screen.queryByText('Nothing is installed yet')).toBeNull()
  })

  // allSettled, not all: 9.7 gives a principal a narrowed scope set, and a 403 on one route
  // must cost that route's own number and nothing else.
  it('loses only the section whose route was refused', async () => {
    await withHealth(ONE_DORMANT, { ...BUSY, refuse: ['/api/config'] })

    expect(screen.getByRole('alert').textContent).toBe('Something went wrong')
    // The Roles tile keeps its count, from /api/roles, and loses only the note /api/config fed.
    expect(screen.getByText('Roles').closest('div')?.textContent).toBe('Roles2')
    expect(screen.queryByText('no default role')).toBeNull()
    expect(screen.queryByText(/^default:/)).toBeNull()
    // Every other section, untouched.
    expect(within(sectionOf('Substrate health')).getByText('of 5 plugins germinated')).toBeDefined()
    expect(screen.getByText('128')).toBeDefined()
    expect(screen.getByText('3 unavailable')).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Needs attention · 1' })).toBeDefined()
    expect(screen.getByLabelText('Search plugins, people, commands')).toBeDefined()
  })

  // The tile convention: a refused route leaves the tile standing with nothing where its
  // number would be — never a 0, which would read as a substrate with no source at all.
  it('withholds a tile number for the one route that was refused, keeping the tile', async () => {
    await withHealth(GERMINATED, { ...BUSY, refuse: ['/api/sources'] })

    expect(screen.getByText('Sources')).toBeDefined()
    expect(screen.getByText('128')).toBeDefined()
    expect(screen.queryByText('—')).toBeNull()
  })

  // Discriminates the plugin slot from the rest: the corpus and the health card go, the four
  // counts that come from other routes stay.
  it('keeps the people and roles counts when only the plugin route was refused', async () => {
    await withHealth(GERMINATED, { ...BUSY, refuse: ['/api/plugins'] })

    expect(screen.getByText('128')).toBeDefined()
    expect(screen.getByText('default: guest')).toBeDefined()
    expect(within(sectionOf('Substrate health')).queryByText(/plugins germinated/)).toBeNull()
    expect(screen.queryByText('3 unavailable')).toBeNull()
  })

  // Finding 6, under the branch's one convention: `of 0 plugins germinated` reads as an empty
  // substrate, and a marker in its place is one more thing to learn — so the whole sentence
  // and the number above it are withheld. `—` means a confirmed-empty field elsewhere.
  it('withholds the hero sentence entirely for a count it could not read', async () => {
    await withHealth(GERMINATED, 'fail')
    const card = sectionOf('Substrate health')

    expect(within(card).queryByText(/plugins germinated/)).toBeNull()
    expect(within(card).queryByTestId('germinated-count')).toBeNull()
    expect(within(card).queryByText('—')).toBeNull()
  })

  // The other half of the convention: a confirmed count renders as a number, zero included.
  it('prints a confirmed total, so withholding is not the same as an empty substrate', async () => {
    await withHealth(GERMINATED, BUSY)
    const card = sectionOf('Substrate health')

    expect(within(card).getByText('of 5 plugins germinated')).toBeDefined()
    expect(within(card).getByTestId('germinated-count').textContent).toBe('2')
  })

  // Decision: an unreadable count is reported through its own alert, matching every other
  // screen's fetch-error shape — never a silent "all done" over a count nobody confirmed.
  it('reports a fetch failure of the counts through its own alert, and keeps the tiles', async () => {
    await withHealth(GERMINATED, 'fail')

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Something went wrong')
    expect(screen.getByText('Everything is germinated.')).toBeDefined()
    expect(screen.getByText('People')).toBeDefined()
    expect(screen.getByText('Commands')).toBeDefined()
  })
})
