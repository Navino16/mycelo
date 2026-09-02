import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { MemoryRouter } from 'react-router'
import { ChromeContext, ChromeProvider, useUptimeLine } from '../../src/chrome.tsx'
import { HealthContext } from '../../src/health.tsx'
import { I18nProvider } from '../../src/i18n.tsx'
import { Nav } from '../../src/shell/Nav.tsx'
import type { ChromeValue } from '../../src/chrome.tsx'
import type { RuntimeHealth, SubstrateDto } from '../../src/api/types.ts'

const UP = 14 * 86_400 + 3 * 3_600

function Line(): React.JSX.Element {
  return <span data-testid="line">{useUptimeLine() ?? 'nothing'}</span>
}

function withSubstrate(substrate: SubstrateDto | null): void {
  const value: ChromeValue = { substrate, counts: null, host: 'substrate.home.lan' }
  render(<I18nProvider><ChromeContext value={value}><Line /></ChromeContext></I18nProvider>)
}

describe('useUptimeLine', () => {
  // packages/core/package.json is version 0.0.0 until phase 9.8 cuts the real one, so the
  // chrome would otherwise print `mycelo 0.0.0` on every deployment there has ever been.
  it('shows the uptime alone while the version is the 0.0.0 placeholder', () => {
    withSubstrate({ version: '0.0.0', startedAt: '2026-01-01', uptimeSeconds: UP })

    expect(screen.getByTestId('line').textContent).toBe('up 14d 03h')
  })

  it('names a real version before the uptime', () => {
    withSubstrate({ version: '0.9.3', startedAt: '2026-01-01', uptimeSeconds: UP })

    expect(screen.getByTestId('line').textContent).toBe('mycelo 0.9.3 · up 14d 03h')
  })

  it('treats a missing version like the placeholder', () => {
    withSubstrate({ startedAt: '2026-01-01', uptimeSeconds: UP } as unknown as SubstrateDto)

    expect(screen.getByTestId('line').textContent).toBe('up 14d 03h')
  })

  // `up 0s` is indistinguishable from a fresh boot, which is the silent-when-wrong shape:
  // an uptime that cannot be read must render nothing at all.
  it('renders nothing when the uptime is not a finite number', () => {
    withSubstrate({ version: '0.9.3', startedAt: '2026-01-01', uptimeSeconds: Number.NaN })

    expect(screen.getByTestId('line').textContent).toBe('nothing')
  })

  it('renders nothing when the payload carries no uptime at all', () => {
    withSubstrate({ version: '0.9.3' } as unknown as SubstrateDto)

    expect(screen.getByTestId('line').textContent).toBe('nothing')
  })

  it('renders nothing before /api/substrate answers', () => {
    withSubstrate(null)

    expect(screen.getByTestId('line').textContent).toBe('nothing')
  })

  it('speaks the locale it is rendered in', () => {
    globalThis.localStorage?.setItem('mycelo.locale', 'fr')
    withSubstrate({ version: '0.9.3', startedAt: '2026-01-01', uptimeSeconds: 2 * 86_400 })

    expect(screen.getByTestId('line').textContent).toBe('mycelo 0.9.3 · actif depuis 2j 00h')
  })
})

const HEALTHY: RuntimeHealth = {
  mode: 'germinated', dormant: [], enforcingBlocked: [], rhizas: [], blockedSinceBoot: 0,
}

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const PLUGINS = {
  hypha: [{ name: 'signal', kind: 'hypha', commands: [], state: 'germinated', enabled: true }],
  rhiza: [{ name: 'radarr', kind: 'rhiza', commands: [], state: 'dormant', enabled: true }],
  enzyme: [],
  inhibitor: [],
  unknown: [],
}

/** Renders the real provider around Nav, so the counts come from fetches rather than a fixture. */
function withCounts(refuse: readonly string[]): void {
  globalThis.fetch = mock((url: string) => {
    if (refuse.includes(url)) return Promise.resolve(json({ error: { message: 'refused' } }, 500))
    if (url === '/api/substrate') return Promise.resolve(json({ version: '0.9.3', startedAt: 'x', uptimeSeconds: 60 }))
    if (url === '/api/plugins') return Promise.resolve(json(PLUGINS))
    if (url === '/api/sources') return Promise.resolve(json([{ id: 1, label: 'Registry', driver: 'github', location: 'x', official: true, enabled: true }]))
    if (url === '/api/roles') return Promise.resolve(json([{ name: 'owner', builtin: true, patterns: ['*'] }, { name: 'guest', builtin: false, patterns: [] }]))
    if (url.startsWith('/api/people')) return Promise.resolve(json({ items: [], page: 1, perPage: 1, total: 128 }))
    return Promise.resolve(json({ error: { message: 'unhandled in test' } }, 404))
  }) as unknown as typeof fetch

  render(
    <I18nProvider>
      <HealthContext value={{ health: HEALTHY, error: false, refresh: () => Promise.resolve() }}>
        <MemoryRouter initialEntries={['/plugins']}>
          <ChromeProvider><Nav /></ChromeProvider>
        </MemoryRouter>
      </HealthContext>
    </I18nProvider>,
  )
}

function countOf(label: string): string | undefined {
  return screen.getByRole('link', { name: new RegExp(`^${label}`) }).textContent?.slice(label.length)
}

describe('ChromeProvider counts', () => {
  it('renders every count when every route answers', async () => {
    withCounts([])

    await waitFor(() => { expect(countOf('Plugins')).toBe('2') })
    expect(countOf('Sources')).toBe('1')
    expect(countOf('Roles')).toBe('2')
    expect(countOf('People')).toBe('128')
    expect(countOf('Overview')).toBe('1')
  })

  // allSettled, not all: one refused route used to blank all five counts, so a principal
  // without one scope would see a sidebar with no numbers at all.
  it('keeps the other counts when one route refuses', async () => {
    withCounts(['/api/roles'])

    await waitFor(() => { expect(countOf('Plugins')).toBe('2') })
    expect(countOf('Sources')).toBe('1')
    expect(countOf('People')).toBe('128')
    expect(countOf('Roles')).toBe('')
  })

  it('keeps the counts when the plugins route is the one that refuses', async () => {
    withCounts(['/api/plugins'])

    await waitFor(() => { expect(countOf('People')).toBe('128') })
    expect(countOf('Plugins')).toBe('')
    expect(countOf('Overview')).toBe('')
    expect(countOf('Roles')).toBe('2')
  })
})
