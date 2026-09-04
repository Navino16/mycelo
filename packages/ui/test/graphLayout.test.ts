import { describe, expect, it } from 'bun:test'
import { COLUMNS, columnOf, isBroken, layout } from '../src/graphLayout.ts'
import type { GraphDto, GraphNode } from '../src/api/types.ts'

function node(
  name: string, kind?: GraphNode['kind'], state: GraphNode['state'] = 'germinated',
): GraphNode {
  return { name, ...(kind === undefined ? {} : { kind }), state }
}

// One node per column, plus a second hypha, so a swapped axis or a collapsed column shows.
const GRAPH: GraphDto = {
  nodes: [
    node('signal', 'hypha'),
    node('discord', 'hypha'),
    node('allowlist', 'inhibitor'),
    { name: 'core', state: 'germinated' },
    node('radarr-search', 'enzyme'),
    node('radarr', 'rhiza'),
    node('brokenyaml', undefined, 'dormant'),
  ],
  edges: [{ from: 'radarr-search', to: 'radarr', optional: false }],
}

describe('the five columns', () => {
  // design 2k's caption: left to right, channels → filters → core → commands → systems.
  it('places each kind in its design column, with core in the middle', () => {
    expect(columnOf(node('signal', 'hypha'))).toBe(0)
    expect(columnOf(node('allowlist', 'inhibitor'))).toBe(1)
    expect(columnOf({ name: 'core', state: 'germinated' })).toBe(2)
    expect(columnOf(node('radarr-search', 'enzyme'))).toBe(3)
    expect(columnOf(node('radarr', 'rhiza'))).toBe(4)
  })

  // A node whose manifest never parsed has no kind and must still be placed, not dropped.
  it('places a kind-less node at the far right rather than losing it', () => {
    expect(columnOf(node('brokenyaml', undefined, 'dormant'))).toBe(5)
    expect(columnOf(node('brokenyaml', undefined, 'dormant'))).toBe(COLUMNS.length - 1)
  })

  // A kind the SPA does not know yet (a septum minor adding one) must not land at x = -226.
  it('places a kind it does not know in the last column, never off the canvas', () => {
    expect(columnOf({ name: 'future', kind: 'sporangium' as GraphNode['kind'], state: 'germinated' }))
      .toBe(COLUMNS.length - 1)
  })

  it('places every node, never dropping one that has no edge', () => {
    expect(layout(GRAPH).map((n) => n.name).sort())
      .toEqual(['allowlist', 'brokenyaml', 'core', 'discord', 'radarr', 'radarr-search', 'signal'])
  })

  // Pins the column width against the row height: only fixed values catch x and y aliased.
  it('grows x by the column, left to right in the design order', () => {
    const placed = new Map(layout(GRAPH).map((n) => [n.name, n]))

    expect(placed.get('signal')?.x).toBe(0)
    expect(placed.get('allowlist')?.x).toBe(226)
    expect(placed.get('core')?.x).toBe(452)
    expect(placed.get('radarr-search')?.x).toBe(678)
    expect(placed.get('radarr')?.x).toBe(904)
    expect(placed.get('brokenyaml')?.x).toBe(1130)
  })

  it('spreads nodes sharing a column downward, not on top of each other', () => {
    const placed = layout(GRAPH)
    const hyphae = placed.filter((n) => n.column === 0)

    expect(hyphae.map((n) => n.name)).toEqual(['signal', 'discord'])
    expect(hyphae.map((n) => n.y)).toEqual([0, 79])
    expect(new Set(hyphae.map((n) => n.x)).size).toBe(1)
  })

  // The old layout read depth off the edges; the design's order is the kind's alone.
  it('places a node identically whether or not it has an edge', () => {
    const withoutEdges = layout({ nodes: GRAPH.nodes, edges: [] })

    expect(withoutEdges).toEqual(layout(GRAPH))
  })
})

describe('the edge semantics', () => {
  const byName = new Map<string, GraphNode>([
    ['enzyme', node('enzyme', 'enzyme')],
    ['broken', node('broken', 'rhiza', 'dormant')],
    ['fine', node('fine', 'rhiza')],
    ['sleeper', node('sleeper', 'enzyme', 'dormant')],
  ])

  it('is broken when the target is dormant', () => {
    expect(isBroken({ from: 'enzyme', to: 'broken', optional: false }, byName)).toBe(true)
  })

  it('is broken when the source is dormant', () => {
    expect(isBroken({ from: 'sleeper', to: 'fine', optional: false }, byName)).toBe(true)
  })

  // The discriminating case: the SPA dashed `optional` and greyed the broken edge, exactly
  // inverted from design note 2k.
  it('is not broken merely because it is optional', () => {
    expect(isBroken({ from: 'enzyme', to: 'fine', optional: true }, byName)).toBe(false)
  })

  it('is not broken between two germinated nodes', () => {
    expect(isBroken({ from: 'enzyme', to: 'fine', optional: false }, byName)).toBe(false)
  })

  // ruling F11: the graph drew `radarr · degraded · HTTP 401` as a plain intact edge while
  // the Overview called the same plugin down in the same second. Every state but germinated
  // is a break, so a state added later cannot silently read as healthy.
  it('is broken when an end is degraded or unreachable, not only dormant', () => {
    const runtime = new Map<string, GraphNode>([
      ['enzyme', node('enzyme', 'enzyme')],
      ['degraded', node('degraded', 'rhiza', 'degraded')],
      ['silent', node('silent', 'rhiza', 'unreachable')],
    ])

    expect(isBroken({ from: 'enzyme', to: 'degraded', optional: false }, runtime)).toBe(true)
    expect(isBroken({ from: 'enzyme', to: 'silent', optional: false }, runtime)).toBe(true)
  })

  // An edge naming a node the response never sent is dropped by the screen, so an unknown
  // end must not read as a break on its own.
  it('is not broken merely because an end is unknown', () => {
    expect(isBroken({ from: 'enzyme', to: 'ghost', optional: false }, byName)).toBe(false)
  })
})
