import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { CriticalBanner } from '../src/components/CriticalBanner.tsx'
import { HealthContext, HealthProvider, useHealth } from '../src/health.tsx'
import { I18nProvider } from '../src/i18n.tsx'
import type { RuntimeHealth } from '../src/api/types.ts'

const GERMINATED: RuntimeHealth = {
  mode: 'germinated', dormant: [], enforcingBlocked: [], rhizas: [],
}

function withHealth(health: RuntimeHealth | null): void {
  render(
    <I18nProvider>
      <HealthContext value={{ health, error: false, refresh: () => Promise.resolve() }}>
        <CriticalBanner />
      </HealthContext>
    </I18nProvider>,
  )
}

describe('the critical banner', () => {
  it('says nothing when nothing is blocked', () => {
    withHealth(GERMINATED)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  // The distinction design §12 calls silent-when-wrong: [] and a missing key must differ.
  it('names every blocked inhibitor, not just the first', () => {
    withHealth({ ...GERMINATED, enforcingBlocked: ['group-gate', 'house-rules'] })

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('group-gate')
    expect(alert.textContent).toContain('house-rules')
  })

  it('warns when the health shape carries no enforcingBlocked at all', () => {
    const malformed = { mode: 'germinated', dormant: [], rhizas: [] } as unknown as RuntimeHealth
    withHealth(malformed)

    // Absent is not the same fact as empty: it means the reader cannot know, and a screen
    // that renders it as "all clear" reports a mute bot as healthy.
    expect(screen.getByRole('alert').textContent).toContain('?')
  })

  it('says the substrate is not answering when the poll failed', () => {
    render(
      <I18nProvider>
        <HealthContext value={{ health: null, error: true, refresh: () => Promise.resolve() }}>
          <CriticalBanner />
        </HealthContext>
      </I18nProvider>,
    )
    expect(screen.getByRole('alert')).toBeDefined()
  })
})

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

function Probe(): React.JSX.Element {
  const { health } = useHealth()
  return <span data-testid="mode">{health?.mode ?? 'none'}</span>
}

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

describe('HealthProvider', () => {
  // Every screen calls useHealth() against the same provider (spec §10.2): one poll, not one
  // per consumer, and a real 15s wait — advanced here by invoking the scheduled callback
  // directly, so this test does not take 15 real seconds and does not depend on fake timers.
  it('shares one 15s poll across every consumer', async () => {
    let calls = 0
    globalThis.fetch = mock(() => {
      calls += 1
      return Promise.resolve(jsonResponse({ mode: 'germinated', dormant: [], enforcingBlocked: [], rhizas: [] }))
    })
    const setIntervalSpy = spyOn(globalThis, 'setInterval')

    render(
      <I18nProvider>
        <HealthProvider>
          <Probe />
          <Probe />
        </HealthProvider>
      </I18nProvider>,
    )

    await waitFor(() => { expect(screen.getAllByTestId('mode')[0]?.textContent).toBe('germinated') })
    expect(screen.getAllByTestId('mode')[1]?.textContent).toBe('germinated')
    // Two consumers, one fetch: a private poll per consumer would make this 2.
    expect(calls).toBe(1)

    // Filtered on the 15s interval, not a bare call count: testing-library's own `waitFor`
    // falls back to polling with `setInterval` too, on the same spied global.
    const pollCalls = setIntervalSpy.mock.calls.filter(([, ms]) => ms === 15_000)
    expect(pollCalls).toHaveLength(1)

    const tick = pollCalls[0]?.[0] as () => void
    tick()
    await waitFor(() => { expect(calls).toBe(2) })

    setIntervalSpy.mockRestore()
  })
})
