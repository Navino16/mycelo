import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { HealthProvider, POLL_MS, useHealth } from '../src/health.tsx'
import { I18nProvider } from '../src/i18n.tsx'

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

    // try/finally: a thrown assertion above must not leak this spy into every test that runs
    // after it in the same process.
    try {
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
      const pollCalls = setIntervalSpy.mock.calls.filter(([, ms]) => ms === POLL_MS)
      expect(pollCalls).toHaveLength(1)

      const tick = pollCalls[0]?.[0] as () => void
      tick()
      await waitFor(() => { expect(calls).toBe(2) })
    } finally {
      setIntervalSpy.mockRestore()
    }
  })

  // A poll that fails must not leave the "substrate not answering" state stuck once a later
  // poll succeeds — discriminates the success branch actually clearing `error`.
  it('clears the error once a later poll succeeds', async () => {
    let succeed = false
    globalThis.fetch = mock(() => succeed
      ? Promise.resolve(jsonResponse({ mode: 'germinated', dormant: [], enforcingBlocked: [], rhizas: [] }))
      : Promise.reject(new Error('down')))

    function ErrorProbe(): React.JSX.Element {
      const { error, refresh } = useHealth()
      return <button type="button" onClick={() => { void refresh() }}>{error ? 'down' : 'up'}</button>
    }

    render(
      <I18nProvider>
        <HealthProvider><ErrorProbe /></HealthProvider>
      </I18nProvider>,
    )

    await waitFor(() => { expect(screen.getByRole('button').textContent).toBe('down') })

    succeed = true
    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => { expect(screen.getByRole('button').textContent).toBe('up') })
  })
})
