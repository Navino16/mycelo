import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { MemoryRouter, Route, Routes } from 'react-router'
import { HealthContext } from '../../src/health.tsx'
import { I18nProvider } from '../../src/i18n.tsx'
import { HealthPill, healthPillState } from '../../src/shell/HealthPill.tsx'
import { Layout } from '../../src/shell/Layout.tsx'
import type { RuntimeHealth } from '../../src/api/types.ts'

const OK: RuntimeHealth = {
  mode: 'germinated', dormant: [], enforcingBlocked: [], rhizas: [], blockedSinceBoot: 0,
}

function pill(health: RuntimeHealth | null, error = false): void {
  render(
    <I18nProvider>
      <HealthContext value={{ health, error, refresh: () => Promise.resolve() }}>
        <HealthPill />
      </HealthContext>
    </I18nProvider>,
  )
}

describe('healthPillState', () => {
  it('is healthy only when nothing is dormant, blocked or unhealthy', () => {
    expect(healthPillState(OK, false).state).toBe('healthy')
  })

  // design note 2j: mute is the one red condition, so nothing else may produce it.
  it('is mute for a blocked enforcing inhibitor and for nothing else', () => {
    expect(healthPillState({ ...OK, enforcingBlocked: ['gate'] }, false).state).toBe('mute')
    expect(healthPillState({ ...OK, dormant: [{ name: 'radarr', reason: 'x' }] }, false).state).toBe('degraded')
    expect(healthPillState({ ...OK, mode: 'degraded' }, false).state).toBe('degraded')
    expect(healthPillState(OK, true).state).toBe('offline')
  })

  // CriticalBanner has four branches, not three, and this project's rule is that the
  // metaphor never replaces information: a failed poll and a malformed payload are two facts.
  it('keeps a failed poll and an unreadable payload apart', () => {
    expect(healthPillState(OK, true).state).toBe('offline')
    expect(healthPillState({ ...OK, enforcingBlocked: undefined as unknown as string[] }, false).state)
      .toBe('unreadable')
  })

  // Discriminates Array.isArray from a bare truthiness check: a truthy non-array is the trap.
  it('is unreadable, never healthy, when enforcingBlocked is not an array', () => {
    expect(healthPillState({ ...OK, enforcingBlocked: { oops: true } as unknown as string[] }, false).state)
      .toBe('unreadable')
    expect(healthPillState({ ...OK, dormant: undefined as unknown as [] }, false).state).toBe('unreadable')
    expect(healthPillState({ ...OK, rhizas: undefined as unknown as [] }, false).state).toBe('unreadable')
  })

  it('counts dormant plugins and unhealthy rhizas together, not one of the two', () => {
    const { issues } = healthPillState({
      ...OK,
      dormant: [{ name: 'a', reason: 'x' }, { name: 'b', reason: 'y' }],
      rhizas: [
        { rhiza: 'ok', status: { state: 'healthy', checkedAt: '2026-01-01' } },
        { rhiza: 'down', status: { state: 'unreachable', checkedAt: '2026-01-01' } },
      ],
    }, false)

    expect(issues).toBe(3)
  })

  // 2j: a mute bot is usually also degraded, and mute outranks it — "none of it matters while
  // the bot is mute". It still carries the count, or task 16's takeover has nothing to recount from.
  it('stays mute when the bot is degraded too, and keeps the issue count', () => {
    const { state, issues } = healthPillState(
      { ...OK, mode: 'degraded', enforcingBlocked: ['gate'], dormant: [{ name: 'a', reason: 'x' }] }, false,
    )

    expect(state).toBe('mute')
    expect(issues).toBe(1)
  })
})

describe('the pill', () => {
  it('names the count when there is more than one issue', () => {
    pill({ ...OK, dormant: [{ name: 'a', reason: 'x' }, { name: 'b', reason: 'y' }] })

    expect(screen.getByText('Degraded · 2 issues')).toBeDefined()
  })

  // One issue through a plural sentence reads "1 issues"; the count is the commonest value.
  it('says one issue in the singular', () => {
    pill({ ...OK, dormant: [{ name: 'a', reason: 'x' }] })

    expect(screen.getByText('Degraded · 1 issue')).toBeDefined()
  })

  it('says Mute for a blocked enforcing inhibitor, and paints it crit', () => {
    pill({ ...OK, enforcingBlocked: ['gate'] })

    expect(screen.getByRole('status').getAttribute('data-tone')).toBe('crit')
    expect(screen.getByText('Mute')).toBeDefined()
  })

  // design note 2j: red is the mute bot's alone, so a failed poll is amber, not red.
  it('does not paint an unreachable substrate red', () => {
    pill(null, true)

    expect(screen.getByRole('status').getAttribute('data-tone')).toBe('warn')
    expect(screen.getByText('Not answering')).toBeDefined()
  })

  it('renders nothing at all before the first poll answers', () => {
    pill(null)

    expect(screen.queryByRole('status')).toBeNull()
  })
})

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
}

describe('the shell carries the pill everywhere', () => {
  // design note 1a: the pill is the only element persistent across every screen, and it is
  // journey D's entry point — a pill only on the Overview would strand journey D.
  it('renders the health pill on a screen other than the overview', async () => {
    globalThis.fetch = mock((url: string) => {
      if (url === '/api/substrate') {
        return Promise.resolve(json({ version: '0.9.3', startedAt: '2026-01-01', uptimeSeconds: 100 }))
      }
      return Promise.resolve(json({}))
    }) as unknown as typeof fetch

    render(
      <I18nProvider>
        <HealthContext
          value={{
            health: { ...OK, enforcingBlocked: ['gate'] },
            error: false,
            refresh: () => Promise.resolve(),
          }}
        >
          <MemoryRouter initialEntries={['/roles']}>
            <Routes>
              <Route path="/" element={<Layout />}>
                <Route path="roles" element={<p>the roles screen</p>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </HealthContext>
      </I18nProvider>,
    )

    expect(await screen.findByText('the roles screen')).toBeDefined()
    expect(await screen.findByText('Mute')).toBeDefined()
  })
})
