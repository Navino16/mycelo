import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { I18nProvider } from '../../src/i18n.tsx'
import { Graph } from '../../src/screens/Graph.tsx'
import type { GraphDto } from '../../src/api/types.ts'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

const GRAPH: GraphDto = {
  nodes: [
    { name: 'signal', kind: 'hypha', state: 'germinated' },
    { name: 'radarr', kind: 'rhiza', state: 'germinated' },
    { name: 'upcoming', kind: 'enzyme', state: 'germinated' },
    { name: 'orphan', kind: 'enzyme', state: 'dormant', reason: 'radarr2 is not installed' },
  ],
  edges: [{ from: 'upcoming', to: 'radarr', optional: false }],
}

// The four edge cases R4 distinguishes, on the synthetic `core` node task 14 emits.
const EDGES: GraphDto = {
  nodes: [
    { name: 'core', state: 'germinated' },
    { name: 'signal', kind: 'hypha', state: 'germinated' },
    { name: 'radarr', kind: 'rhiza', state: 'germinated' },
    { name: 'sonarr', kind: 'rhiza', state: 'dormant', reason: 'url: Invalid input' },
    { name: 'upcoming', kind: 'enzyme', state: 'germinated' },
    { name: 'orphan', kind: 'enzyme', state: 'dormant', reason: 'radarr2 is not installed' },
  ],
  edges: [
    { from: 'upcoming', to: 'radarr', optional: false },
    { from: 'signal', to: 'core', optional: true },
    { from: 'orphan', to: 'radarr', optional: false },
    { from: 'upcoming', to: 'sonarr', optional: false },
  ],
}

function serve(body: unknown): void {
  globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  })))
}

function serveError(): void {
  globalThis.fetch = mock(() => Promise.resolve(new Response('{"error":{"message":"x"}}', {
    status: 500, headers: { 'content-type': 'application/json' },
  })))
}

function renderGraph(): void {
  render(<I18nProvider><MemoryRouter><Graph /></MemoryRouter></I18nProvider>)
}

function Path(): React.JSX.Element { return <p data-testid="path">{useLocation().pathname}</p> }

function renderRouted(): void {
  render(
    <I18nProvider>
      <MemoryRouter initialEntries={['/']}>
        <Path />
        <Routes>
          <Route path="/" element={<Graph />} />
          <Route path="/plugins/:name" element={<p>plugin detail</p>} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  )
}

function edge(from: string, to: string): Element | null {
  return document.querySelector(`[data-edge="${from}->${to}"]`)
}

describe('the anastomosis graph', () => {
  it('says something went wrong when the fetch fails, rather than staying blank', async () => {
    serveError()
    renderGraph()

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Something went wrong')
  })

  it('renders the graph on success, with no error banner', async () => {
    serve(GRAPH)
    renderGraph()

    await waitFor(() => { expect(screen.getAllByText('signal').length).toBeGreaterThan(0) })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  // fact 1: a degraded substrate answers { nodes: [], edges: [] }, never a broken node.
  it('says there is nothing to draw when the substrate has nothing germinated', async () => {
    serve({ nodes: [], edges: [] })
    renderGraph()

    expect(await screen.findByText('Nothing to draw')).toBeDefined()
    expect(screen.queryByRole('img')).toBeNull()
  })

  // brief §5: the metaphor never replaces information — a dormant node has no kind to
  // label it by, so its literal reason is what the screen must show instead.
  it('shows the literal reason beside a dormant node, never the word alone', async () => {
    serve(GRAPH)
    renderGraph()

    await waitFor(() => { expect(screen.getAllByText('orphan').length).toBeGreaterThan(0) })
    expect(screen.getAllByText('radarr2 is not installed').length).toBeGreaterThan(0)
  })

  // A Zod refusal runs to hundreds of characters; drawn whole at the node it overlaps its
  // neighbours (plan defect 30). The SVG shows a bounded prefix, the full text sits in <title>
  // and on the mobile card.
  it('bounds a long dormant reason in the SVG and keeps the full text in a title', async () => {
    const reason = 'configuration rejected: ' + Array.from({ length: 4 }, () => 'url: Invalid input: expected string, received undefined').join('; ')
    serve({ ...GRAPH, nodes: [...GRAPH.nodes.filter((n) => n.name !== 'orphan'), { name: 'orphan', state: 'dormant', reason }] })
    renderGraph()

    await waitFor(() => { expect(screen.getAllByText('orphan').length).toBeGreaterThan(0) })
    const drawn = screen.getByTestId('graph-desktop').querySelector('[data-reason="orphan"]')
    expect(drawn?.textContent?.length).toBeLessThanOrEqual(60)
    expect(drawn?.textContent?.endsWith('…')).toBe(true)
    expect(screen.getByTestId('graph-desktop').querySelector('title')?.textContent).toBe(reason)
    expect(within(screen.getByTestId('graph-mobile')).getByText(reason)).toBeDefined()
  })

  // A component test cannot see a viewport: assert both renderings exist and each carries
  // every node, rather than relying on which one a real browser would hide.
  it('places every node in both the desktop graph and the mobile card list', async () => {
    serve(GRAPH)
    renderGraph()

    const desktop = await screen.findByTestId('graph-desktop')
    const mobile = screen.getByTestId('graph-mobile')
    expect(desktop.className).toContain('hidden')
    expect(desktop.className).toContain('md:block')
    expect(mobile.className).toContain('md:hidden')

    for (const name of ['signal', 'radarr', 'upcoming', 'orphan']) {
      expect(within(desktop).getByText(name)).toBeDefined()
      expect(within(mobile).getByText(name)).toBeDefined()
    }
  })

  // R4, both halves: a dash means a dormant endpoint, and it says so at either end.
  it('dashes a broken edge in amber, whichever end is dormant', async () => {
    serve(EDGES)
    renderGraph()

    await waitFor(() => { expect(edge('orphan', 'radarr')).not.toBeNull() })
    for (const broken of [edge('orphan', 'radarr'), edge('upcoming', 'sonarr')]) {
      expect(broken?.getAttribute('stroke-dasharray')).toBe('6 4')
      expect(broken?.getAttribute('stroke')).toBe('var(--color-warn)')
    }
  })

  // The discriminating case: the SPA dashed `optional`, which spent the dash on something
  // that is not a failure at all.
  it('leaves an intact optional edge solid and only quieter', async () => {
    serve(EDGES)
    renderGraph()

    await waitFor(() => { expect(edge('signal', 'core')).not.toBeNull() })
    const optional = edge('signal', 'core')
    expect(optional?.getAttribute('stroke-dasharray')).toBeNull()
    expect(optional?.getAttribute('stroke')).toBe('var(--color-line)')
    expect(optional?.getAttribute('opacity')).toBe('0.6')
  })

  it('draws an intact required edge as a plain full-strength line', async () => {
    serve(EDGES)
    renderGraph()

    await waitFor(() => { expect(edge('upcoming', 'radarr')).not.toBeNull() })
    const intact = edge('upcoming', 'radarr')
    expect(intact?.getAttribute('stroke-dasharray')).toBeNull()
    expect(intact?.getAttribute('stroke')).toBe('var(--color-line)')
    expect(intact?.getAttribute('opacity')).toBeNull()
  })

  // R1: amber is dormancy everywhere; red belongs to the mute bot alone.
  it('paints a dormant node amber and a germinated one green, never red', async () => {
    serve(EDGES)
    renderGraph()

    const desktop = await screen.findByTestId('graph-desktop')
    const box = (name: string): Element | null => desktop.querySelector(`[data-node="${name}"] rect`)

    expect(box('orphan')?.getAttribute('stroke')).toBe('var(--color-warn)')
    expect(box('orphan')?.getAttribute('fill')).toBe('var(--color-warn-bg)')
    expect(box('radarr')?.getAttribute('stroke')).toBe('var(--color-ok)')
    expect(box('radarr')?.getAttribute('fill')).toBe('var(--color-ok-bg)')
    expect(desktop.innerHTML).not.toContain('crit')
  })

  it('renders the core node narrower than a plugin, as the design draws it', async () => {
    serve(EDGES)
    renderGraph()

    const desktop = await screen.findByTestId('graph-desktop')
    const width = (name: string): number =>
      Number(desktop.querySelector(`[data-node="${name}"] rect`)?.getAttribute('width'))

    expect(width('core')).toBe(96)
    expect(width('radarr')).toBe(166)
  })

  // The count is of plugins: `core` is the substrate, and counting it would overstate by one.
  it('summarises the substrate without counting core as a plugin', async () => {
    serve(EDGES)
    renderGraph()

    expect(await screen.findByText('5 plugins · 4 links · 2 broken')).toBeDefined()
  })

  it('gives the marks a legend and the columns their caption', async () => {
    serve(EDGES)
    renderGraph()

    await waitFor(() => { expect(screen.getByText('germinated')).toBeDefined() })
    expect(screen.getByText('dormant')).toBeDefined()
    expect(screen.getByText('unsatisfied link')).toBeDefined()
    expect(screen.getByText('left to right: channels → filters → core → commands → systems'))
      .toBeDefined()
  })

  it('carries the two cards that explain the break and the breakpoint', async () => {
    serve(EDGES)
    renderGraph()

    expect(await screen.findByText('Reading the break')).toBeDefined()
    expect(screen.getByText(/A dashed edge with an amber node/)).toBeDefined()
    expect(screen.getByText('Why this is desktop only')).toBeDefined()
    // The copy names no breakpoint, so it cannot go stale when the breakpoint moves.
    expect(screen.getByText(/the list below carries the same facts/)).toBeDefined()
  })

  // task 14's contract: the synthetic node has no kind, and 'Unrecognised — manifest did not
  // parse' is a lie about the substrate. The desktop box stays.
  it('keeps core out of the phone list while drawing it in the graph', async () => {
    serve(EDGES)
    renderGraph()

    const desktop = await screen.findByTestId('graph-desktop')
    expect(within(desktop).getByText('core')).toBeDefined()
    expect(within(screen.getByTestId('graph-mobile')).queryByText('core')).toBeNull()
    expect(screen.queryByTestId('graph-kind-unknown')).toBeNull()
  })

  // The drawn label has to fit the box it sits in; the full name stays the accessible name.
  it('clips a name too long for its box and keeps the whole one reachable', async () => {
    const name = 'enzyme-grafana-alerts-digest'
    serve({ nodes: [{ name, kind: 'enzyme', state: 'germinated' }], edges: [] })
    renderGraph()

    const mark = await screen.findByRole('button', { name })
    const label = mark.querySelector('text')?.textContent ?? ''
    expect(label.endsWith('…')).toBe(true)
    expect(label.length).toBeLessThanOrEqual(18)
  })

  it('narrows to the failures and back when the chip is pressed', async () => {
    serve(EDGES)
    renderGraph()

    const chip = await screen.findByRole('button', { name: 'Only failures' })
    expect(chip.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(chip)

    const desktop = screen.getByTestId('graph-desktop')
    expect(chip.getAttribute('aria-pressed')).toBe('true')
    expect(within(desktop).getByText('orphan')).toBeDefined()
    expect(within(desktop).getByText('sonarr')).toBeDefined()
    // Kept because a break needs both its ends to be readable.
    expect(within(desktop).getByText('radarr')).toBeDefined()
    expect(within(desktop).queryByText('signal')).toBeNull()
    expect(edge('signal', 'core')).toBeNull()
    expect(edge('orphan', 'radarr')).not.toBeNull()

    fireEvent.click(chip)
    expect(within(screen.getByTestId('graph-desktop')).getByText('signal')).toBeDefined()
  })

  it('keeps the summary counting the whole substrate while narrowed', async () => {
    serve(EDGES)
    renderGraph()

    fireEvent.click(await screen.findByRole('button', { name: 'Only failures' }))

    expect(screen.getByText('5 plugins · 4 links · 2 broken')).toBeDefined()
  })

  it('does not throw when an edge names a node absent from the response', async () => {
    serve({ ...GRAPH, edges: [...GRAPH.edges, { from: 'upcoming', to: 'ghost', optional: false }] })
    renderGraph()

    await waitFor(() => { expect(screen.getAllByText('upcoming').length).toBeGreaterThan(0) })
    expect(screen.queryByText('ghost')).toBeNull()
  })

  it('routes to the plugin detail when a mobile card is clicked', async () => {
    serve(GRAPH)
    renderRouted()

    await waitFor(() => { expect(screen.getByRole('link', { name: 'radarr' })).toBeDefined() })
    fireEvent.click(screen.getByRole('link', { name: 'radarr' }))
    expect(await screen.findByText('plugin detail')).toBeDefined()
    expect(screen.getByTestId('path')).toHaveProperty('textContent', '/plugins/radarr')
  })

  it('routes to the plugin detail when the desktop mark is activated by keyboard', async () => {
    serve(GRAPH)
    renderRouted()

    const mark = await screen.findByRole('button', { name: 'upcoming' })
    fireEvent.keyDown(mark, { key: 'Enter' })
    expect(await screen.findByText('plugin detail')).toBeDefined()
    expect(screen.getByTestId('path')).toHaveProperty('textContent', '/plugins/upcoming')
  })
})

describe('the graph guards the payload it draws', () => {
  // An edge naming a node the payload does not carry: the canvas guards its own coordinates,
  // so the count in the summary is where a dangling edge shows — as a link nobody can see.
  it('counts no link for an edge whose target is not a node', () => {
    serve({
      nodes: [
        { name: 'core', state: 'germinated' },
        { name: 'upcoming', kind: 'enzyme', state: 'germinated' },
      ],
      edges: [
        { from: 'upcoming', to: 'core', optional: false },
        { from: 'upcoming', to: 'vanished', optional: false },
      ],
    })
    renderGraph()

    return waitFor(() => {
      expect(screen.getByText('1 plugins · 1 links · 0 broken')).toBeDefined()
      expect(document.querySelector('[data-edge="upcoming->vanished"]')).toBeNull()
    })
  })
})
