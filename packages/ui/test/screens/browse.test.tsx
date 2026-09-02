import { render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { MemoryRouter, Route, Routes } from 'react-router'
import { I18nProvider } from '../../src/i18n.tsx'
import { BrowseSource } from '../../src/screens/BrowseSource.tsx'
import { TrustNotice } from '../../src/screens/SporeDetail.tsx'
import type { SourceDto, SporeOffer } from '../../src/api/types.ts'

describe('the trust notice', () => {
  it('warns for a third-party source', () => {
    render(<I18nProvider><MemoryRouter><TrustNotice official={false} /></MemoryRouter></I18nProvider>)
    expect(screen.getByRole('note').textContent).toMatch(/not.*review/i)
  })

  // The control. A warning that appears everywhere says nothing.
  it('says nothing for the official one', () => {
    render(<I18nProvider><MemoryRouter><TrustNotice official /></MemoryRouter></I18nProvider>)
    expect(screen.queryByRole('note')).toBeNull()
  })
})

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

const SOURCE: SourceDto = {
  id: 1, label: 'My mirror', driver: 'github', location: 'https://github.com/a/b', official: false, enabled: true,
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function serve(source: SourceDto, offers: unknown): void {
  globalThis.fetch = mock((url: string) => {
    if (/\/spores$/.test(url)) return Promise.resolve(json(offers))
    return Promise.resolve(json(source))
  }) as unknown as typeof fetch
}

function serveUnreachable(source: SourceDto): void {
  globalThis.fetch = mock((url: string) => {
    if (/\/spores$/.test(url)) {
      return Promise.resolve(json({ error: { message: 'could not read it' } }, 400))
    }
    return Promise.resolve(json(source))
  }) as unknown as typeof fetch
}

/** requireSource (sources.ts) 404s both /:id and /:id/spores for an unknown id alike. */
function serveMissingSource(): void {
  globalThis.fetch = mock(() => Promise.resolve(json({ error: { message: 'not found' } }, 404)))
}

function renderBrowse(): void {
  render(
    <I18nProvider>
      <MemoryRouter initialEntries={['/sources/1']}>
        <Routes><Route path="/sources/:id" element={<BrowseSource />} /></Routes>
      </MemoryRouter>
    </I18nProvider>,
  )
}

describe('browsing a source', () => {
  it('reads as affecting installs only, not as the source being broken, when it cannot answer', async () => {
    serveUnreachable(SOURCE)
    renderBrowse()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('This source is not answering. Installing is affected; nothing running is.')
  })

  // Reachable from a stale bookmark or a source deleted elsewhere: requireSource 404s both
  // endpoints, and the source's own fetch must not be swallowed into a blank, alert-less screen.
  it('shows a generic alert when the source itself cannot be found, rather than staying blank', async () => {
    serveMissingSource()
    renderBrowse()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Something went wrong')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  it('lists the offers on success, with no error banner', async () => {
    const offers: SporeOffer[] = [{ name: 'radarr', strain: '1.2.0' }, { name: 'plex', strain: '2.0.0' }]
    serve(SOURCE, offers)
    renderBrowse()

    await waitFor(() => { expect(screen.getByText('radarr')).toBeDefined() })
    expect(screen.getByText('plex')).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('names the source in the title', async () => {
    serve(SOURCE, [])
    renderBrowse()

    await waitFor(() => { expect(screen.getByText('Available in My mirror')).toBeDefined() })
  })

  it('says the source offers nothing rather than showing an empty list', async () => {
    serve(SOURCE, [])
    renderBrowse()

    await waitFor(() => { expect(screen.getByText('This source offers nothing.')).toBeDefined() })
  })

  // brief §7: a real sporangium offers 20-40 spores, never three sample rows.
  it('renders every offer at scale, none dropped or capped', async () => {
    const offers: SporeOffer[] = Array.from({ length: 30 }, (_, i) => ({
      name: `spore-${String(i + 1)}`, strain: '1.0.0',
    }))
    serve(SOURCE, offers)
    renderBrowse()

    await waitFor(() => { expect(screen.getAllByRole('listitem')).toHaveLength(30) })
    for (const offer of offers) {
      expect(within(screen.getByRole('list')).getByText(offer.name)).toBeDefined()
    }
  })
})
