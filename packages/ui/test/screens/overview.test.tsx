import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { MemoryRouter } from 'react-router'
import { HealthContext } from '../../src/health.tsx'
import { I18nProvider } from '../../src/i18n.tsx'
import { Overview } from '../../src/screens/Overview.tsx'
import type { RuntimeHealth } from '../../src/api/types.ts'

const GERMINATED: RuntimeHealth = { mode: 'germinated', dormant: [], enforcingBlocked: [], rhizas: [] }

function withHealth(health: RuntimeHealth | null): void {
  render(
    <I18nProvider>
      <HealthContext value={{ health, error: false, refresh: () => Promise.resolve() }}>
        <MemoryRouter><Overview /></MemoryRouter>
      </HealthContext>
    </I18nProvider>,
  )
}

describe('the overview', () => {
  it('says everything is germinated when nothing is wrong', () => {
    withHealth(GERMINATED)
    expect(screen.getByText('Everything is germinated.')).toBeDefined()
  })

  // brief §5: the metaphor never replaces information — the reason travels with the name.
  it('names a dormant plugin beside its literal reason, never the word alone', () => {
    withHealth({ ...GERMINATED, dormant: [{ name: 'radarr', reason: 'apiKey: missing required field' }] })

    expect(screen.getByText('radarr')).toBeDefined()
    expect(screen.getByText('apiKey: missing required field')).toBeDefined()
    expect(screen.queryByText('Everything is germinated.')).toBeNull()
  })

  it('names every degraded rhiza, not just the first', () => {
    withHealth({
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

  it('names the germination failure when the bot itself never finished starting', () => {
    withHealth({
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
  it('does not crash on a health payload it cannot read, and says so rather than claiming all is well', () => {
    withHealth({} as unknown as RuntimeHealth)

    expect(screen.getByText('The substrate answered a shape this screen does not understand (?)')).toBeDefined()
    expect(screen.queryByText('Everything is germinated.')).toBeNull()
  })

  // health.ts never sends this shape today, but a bare '!== undefined' let 'failure: null'
  // through to '.message' the same way the unguarded arrays let '{}' through to '.filter'.
  it('does not crash on a null failure in degraded mode', () => {
    withHealth({
      mode: 'degraded', dormant: [], enforcingBlocked: [], rhizas: [],
      failure: null as unknown as RuntimeHealth['failure'],
    })

    expect(screen.getByText('Overview')).toBeDefined()
    expect(screen.queryByText('Germination failed')).toBeNull()
  })
})
