import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { MemoryRouter, Route, Routes } from 'react-router'
import { I18nProvider } from '../../src/i18n.tsx'
import { BrowseSource } from '../../src/screens/BrowseSource.tsx'
import { TrustNotice } from '../../src/screens/SporeDetail.tsx'
import type { PluginDto, PluginGroups, SourceDto, SporeOffer } from '../../src/api/types.ts'

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
  id: 1, label: 'sporangium/core', driver: 'github', location: 'https://github.com/a/b', official: false, enabled: true,
}

function plugin(name: string, extra: Partial<PluginDto> = {}): PluginDto {
  return { name, commands: [], state: 'germinated', enabled: true, ...extra }
}

const EMPTY_GROUPS: PluginGroups = { hypha: [], rhiza: [], enzyme: [], inhibitor: [], unknown: [] }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

interface Options {
  offers?: unknown
  plugins?: PluginGroups
  offersFail?: boolean
  pluginsFail?: boolean
  missing?: boolean
  /** The refusal `/spores` answers with, message included. */
  offersRefusal?: { status: number, message: string }
}

function serve(opts: Options = {}): void {
  globalThis.fetch = mock((url: string) => {
    if (opts.missing === true) return Promise.resolve(json({ error: { message: 'not found' } }, 404))
    if (url === '/api/plugins') {
      return Promise.resolve(opts.pluginsFail === true
        ? json({ error: { message: 'x' } }, 500)
        : json(opts.plugins ?? EMPTY_GROUPS))
    }
    if (/\/spores$/.test(url)) {
      if (opts.offersRefusal !== undefined) {
        const { status, message } = opts.offersRefusal
        return Promise.resolve(json({ error: { code: 'not-found', message } }, status))
      }
      return Promise.resolve(opts.offersFail === true
        ? json({ error: { message: 'could not read it' } }, 400)
        : json(opts.offers ?? []))
    }
    return Promise.resolve(json(SOURCE))
  }) as unknown as typeof fetch
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

function offers(count: number): SporeOffer[] {
  return Array.from({ length: count }, (_, i) => ({ name: `spore-${String(i + 1)}`, strain: '1.0.0' }))
}

describe('browsing a source', () => {
  it('reads as affecting installs only, not as the source being broken, when it cannot answer', async () => {
    serve({ offersFail: true })
    renderBrowse()

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(
      'This source is not answering. Installing is affected; nothing running is.',
    )).toBeDefined()
  })

  // Reachable from a stale bookmark or a source deleted elsewhere: requireSource 404s both
  // endpoints, and the source's own fetch must not be swallowed into a blank, alert-less screen.
  it('shows a generic alert when the source itself cannot be found, rather than staying blank', async () => {
    serve({ missing: true })
    renderBrowse()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Something went wrong')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  it('lists the offers on success, with no error banner', async () => {
    serve({ offers: [{ name: 'radarr', strain: '1.2.0' }, { name: 'plex', strain: '2.0.0' }] })
    renderBrowse()

    await waitFor(() => { expect(screen.getByText('radarr')).toBeDefined() })
    expect(screen.getByText('plex')).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('leads with the trail back to the sources list and the source name', async () => {
    serve({ offers: offers(3) })
    renderBrowse()

    const trail = await screen.findByRole('navigation', { name: 'breadcrumb' })
    expect(trail.textContent).toContain('Sources')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('sporangium/core')
    expect(screen.getByText('3 spores')).toBeDefined()
  })

  it('says the source offers nothing rather than showing an empty list', async () => {
    serve({ offers: [] })
    renderBrowse()

    await waitFor(() => { expect(screen.getByText('This source offers nothing.')).toBeDefined() })
    expect(screen.queryByRole('list')).toBeNull()
  })
})

describe('finding a spore in a source', () => {
  it('filters the listing client-side on what is typed', async () => {
    serve({ offers: [{ name: 'rhiza-radarr', strain: '1.0.0' }, { name: 'hypha-signal', strain: '2.0.0' }] })
    renderBrowse()
    await waitFor(() => { expect(screen.getByText('rhiza-radarr')).toBeDefined() })

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'signal' } })

    expect(screen.getByText('hypha-signal')).toBeDefined()
    expect(screen.queryByText('rhiza-radarr')).toBeNull()
  })

  it('says nothing matched rather than showing an empty list', async () => {
    serve({ offers: [{ name: 'rhiza-radarr', strain: '1.0.0' }] })
    renderBrowse()
    await waitFor(() => { expect(screen.getByText('rhiza-radarr')).toBeDefined() })

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'nothing-like-this' } })

    expect(screen.getByText('No spore in this source matches “nothing-like-this”')).toBeDefined()
    expect(screen.queryByRole('list')).toBeNull()
  })
})

// brief §7: a real sporangium offers 20-40 spores, and 61 is the artboard's own number.
describe('reading a catalogue larger than one page', () => {
  it('shows the first 25 and says how many there are in all', async () => {
    serve({ offers: offers(61) })
    renderBrowse()

    await waitFor(() => { expect(screen.getAllByRole('listitem')).toHaveLength(25) })
    expect(screen.getByText('Showing 1–25 of 61')).toBeDefined()
  })

  it('reveals the next 25 on demand, and stops offering more once everything is shown', async () => {
    serve({ offers: offers(30) })
    renderBrowse()
    await waitFor(() => { expect(screen.getAllByRole('listitem')).toHaveLength(25) })

    fireEvent.click(screen.getByRole('button', { name: 'Load 25 more' }))

    expect(screen.getAllByRole('listitem')).toHaveLength(30)
    expect(screen.getByText('Showing 1–30 of 30')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Load 25 more' })).toBeNull()
  })

  it('offers no paging at all for a catalogue that fits on one page', async () => {
    serve({ offers: offers(4) })
    renderBrowse()

    await waitFor(() => { expect(screen.getAllByRole('listitem')).toHaveLength(4) })
    expect(screen.queryByRole('button', { name: 'Load 25 more' })).toBeNull()
    expect(screen.queryByText(/Showing/)).toBeNull()
  })

  // A search must narrow the whole catalogue, not only the slice already revealed.
  it('searches the whole catalogue, not just the page on screen', async () => {
    serve({ offers: [...offers(40), { name: 'the-last-one', strain: '1.0.0' }] })
    renderBrowse()
    await waitFor(() => { expect(screen.getAllByRole('listitem')).toHaveLength(25) })

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'the-last-one' } })

    expect(screen.getByText('the-last-one')).toBeDefined()
  })
})

describe('what is already installed here', () => {
  const CATALOGUE: SporeOffer[] = [
    { name: 'rhiza-radarr', strain: '2.1.0' },
    { name: 'rhiza-tautulli', strain: '1.2.0' },
    { name: 'enzyme-radarr-search', strain: '3.1.0' },
  ]
  const HERE: PluginGroups = {
    ...EMPTY_GROUPS,
    rhiza: [plugin('rhiza-radarr', { kind: 'rhiza', strain: '1.8.4' })],
    enzyme: [plugin('enzyme-radarr-search', { kind: 'enzyme', strain: '3.1.0', state: 'dormant' })],
  }

  it('marks each offer against what is installed here', async () => {
    serve({ offers: CATALOGUE, plugins: HERE })
    renderBrowse()

    await waitFor(() => { expect(screen.getByTestId('offer-rhiza-radarr')).toBeDefined() })
    expect(within(screen.getByTestId('offer-rhiza-radarr')).getByText('update · installed 1.8.4')).toBeDefined()
    expect(within(screen.getByTestId('offer-rhiza-tautulli')).getByText('not installed')).toBeDefined()
    expect(within(screen.getByTestId('offer-enzyme-radarr-search')).getByText('installed · dormant')).toBeDefined()
  })

  // The discriminating half: a compare that answers "update" whenever a name is known would
  // pass the row above and lie about the one already at the newest strain.
  it('calls an offer already installed at its newest strain installed, not an update', async () => {
    serve({
      offers: [{ name: 'rhiza-radarr', strain: '1.8.4' }],
      plugins: { ...EMPTY_GROUPS, rhiza: [plugin('rhiza-radarr', { kind: 'rhiza', strain: '1.8.4' })] },
    })
    renderBrowse()

    const row = await screen.findByTestId('offer-rhiza-radarr')
    expect(within(row).getByText('installed · germinated')).toBeDefined()
    expect(within(row).queryByText(/update/)).toBeNull()
  })

  // The join is decoration: a refused /api/plugins must cost the note, not the listing.
  it('still lists the offers when the installed-plugins join is refused', async () => {
    serve({ offers: CATALOGUE, pluginsFail: true })
    renderBrowse()

    await waitFor(() => { expect(screen.getAllByRole('listitem')).toHaveLength(3) })
    expect(screen.queryByText('not installed')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('a source that answered a refusal, not a silence', () => {
  // Measured on the scratch install's `local` source: it answered in 1 ms and the screen
  // called it "not answering". The sentence the core sends is the one the operator needs.
  it('renders the server’s refusal instead of calling the source unreachable', async () => {
    serve({
      offersRefusal: {
        status: 404,
        message: 'this is a local spores directory: there is nothing to browse,'
          + ' its spores are already installed',
      },
    })
    renderBrowse()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('this is a local spores directory')
    expect(alert.textContent).not.toContain('not answering')
  })

  // The control, and the rule: only a 404 means the source answered and holds nothing here.
  // Any other refusal is still an unreachable source — with the server's words beneath it,
  // rather than instead of the sentence that says what is and is not affected.
  it('keeps the unreachable headline for a refusal that is not a not-found', async () => {
    serve({ offersFail: true })
    renderBrowse()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('not answering')
    expect(screen.getByText('could not read it')).toBeDefined()
  })
})
