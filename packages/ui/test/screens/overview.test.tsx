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
  })
})
