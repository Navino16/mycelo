import type { GraphDto, GraphNode } from './api/types.ts'

export interface PlacedNode extends GraphNode {
  depth: number
  x: number
  y: number
}

const COLUMN = 200
const ROW = 90

/** Depth by longest path to a leaf, capped: a degraded substrate can carry a cycle. */
function depths(graph: GraphDto): Map<string, number> {
  const requires = new Map<string, string[]>()
  for (const edge of graph.edges) {
    requires.set(edge.from, [...(requires.get(edge.from) ?? []), edge.to])
  }
  const depth = new Map<string, number>()
  const visiting = new Set<string>()

  function walk(name: string): number {
    const known = depth.get(name)
    if (known !== undefined) return known
    if (visiting.has(name)) return 0
    visiting.add(name)
    const children = requires.get(name) ?? []
    const own = children.length === 0 ? 0 : Math.max(...children.map(walk)) + 1
    visiting.delete(name)
    depth.set(name, own)
    return own
  }

  for (const node of graph.nodes) walk(node.name)
  return depth
}

export function layout(graph: GraphDto): readonly PlacedNode[] {
  const depth = depths(graph)
  const perDepth = new Map<number, number>()
  return graph.nodes.map((node) => {
    const d = depth.get(node.name) ?? 0
    const column = perDepth.get(d) ?? 0
    perDepth.set(d, column + 1)
    // Depth grows downward (y) so a requirer sits visibly below what it requires; nodes
    // sharing a depth spread sideways (x), which is what the brief's own test asserts.
    return { ...node, depth: d, x: column * COLUMN, y: d * ROW }
  })
}
