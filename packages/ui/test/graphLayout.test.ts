import { describe, expect, it } from 'bun:test'
import { layout } from '../src/graphLayout.ts'
import type { GraphDto } from '../src/api/types.ts'

const GRAPH: GraphDto = {
  nodes: [
    { name: 'signal', kind: 'hypha', state: 'germinated' },
    { name: 'radarr', kind: 'rhiza', state: 'germinated' },
    { name: 'upcoming', kind: 'enzyme', state: 'germinated' },
    { name: 'orphan', kind: 'enzyme', state: 'dormant', reason: 'radarr2 is not installed' },
  ],
  edges: [{ from: 'upcoming', to: 'radarr', optional: false }],
}

describe('the graph layout', () => {
  it('places every node, never dropping one that has no edge', () => {
    expect(layout(GRAPH).map((n) => n.name).sort())
      .toEqual(['orphan', 'radarr', 'signal', 'upcoming'])
  })

  it('puts a requirer deeper than what it requires, which is what makes a break visible', () => {
    const placed = new Map(layout(GRAPH).map((n) => [n.name, n]))
    expect(placed.get('upcoming')?.depth).toBeGreaterThan(placed.get('radarr')?.depth ?? 0)
  })

  it('gives two nodes at the same depth different positions', () => {
    const sameDepth = layout(GRAPH).filter((n) => n.depth === 0)
    expect(new Set(sameDepth.map((n) => n.x)).size).toBe(sameDepth.length)
  })

  // A cycle is what germination refuses, but a degraded substrate can still be asked for
  // its graph — the layout must terminate rather than recurse forever.
  it('terminates on a cycle', () => {
    const cyclic: GraphDto = {
      nodes: [
        { name: 'alpha', kind: 'enzyme', state: 'dormant' },
        { name: 'beta', kind: 'enzyme', state: 'dormant' },
      ],
      edges: [
        { from: 'alpha', to: 'beta', optional: false },
        { from: 'beta', to: 'alpha', optional: false },
      ],
    }
    expect(layout(cyclic)).toHaveLength(2)
  })
})
