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

    expect(await screen.findByText(/nothing to draw/i)).toBeDefined()
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
    const drawn = screen.getByTestId('graph-desktop').querySelector('text.fill-crit')
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

  // Discriminates `edge.optional ? '6 4' : undefined`: only an optional edge draws dashed.
  it('draws an optional edge dashed and a required one solid', async () => {
    serve({
      ...GRAPH,
      edges: [
        { from: 'upcoming', to: 'radarr', optional: false },
        { from: 'orphan', to: 'radarr', optional: true },
      ],
    })
    renderGraph()

    await waitFor(() => { expect(screen.getAllByText('signal').length).toBeGreaterThan(0) })
    const lines = document.querySelectorAll('line')
    const dashed = [...lines].filter((l) => l.getAttribute('stroke-dasharray') === '6 4')
    const solid = [...lines].filter((l) => l.getAttribute('stroke-dasharray') === null)
    expect(dashed).toHaveLength(1)
    expect(solid).toHaveLength(1)
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
