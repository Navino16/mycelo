import type { GraphDto, GraphEdge, GraphNode, SporeKind } from './api/types.ts'

export interface PlacedNode extends GraphNode {
  column: number
  x: number
  y: number
}

/** The design's five columns, left to right: channels → filters → core → commands → systems. */
export const COLUMNS: readonly (SporeKind | 'core' | 'unknown')[] =
  ['hypha', 'inhibitor', 'core', 'enzyme', 'rhiza', 'unknown']

export const BOX_W = 166
export const BOX_H = 34
const GAP_X = 60
/** Wide enough that a dormant node's reason line fits under its box. */
const GAP_Y = 45

/** By kind, never by dependency depth (design 2k); `core` is synthetic, so it goes by name. */
export function columnOf(node: GraphNode): number {
  const key = node.name === 'core' ? 'core' : (node.kind ?? 'unknown')
  return COLUMNS.indexOf(key)
}

/** R4: an edge is broken when either end is dormant. Optional is a separate, quieter treatment. */
export function isBroken(edge: GraphEdge, byName: ReadonlyMap<string, GraphNode>): boolean {
  return byName.get(edge.from)?.state === 'dormant' || byName.get(edge.to)?.state === 'dormant'
}

export function layout(graph: GraphDto): readonly PlacedNode[] {
  const perColumn = new Map<number, number>()
  return graph.nodes.map((node) => {
    const column = columnOf(node)
    const row = perColumn.get(column) ?? 0
    perColumn.set(column, row + 1)
    return { ...node, column, x: column * (BOX_W + GAP_X), y: row * (BOX_H + GAP_Y) }
  })
}
