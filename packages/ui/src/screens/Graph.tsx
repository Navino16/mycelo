import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { api } from '../api/client.ts'
import { readArray } from '../api/read.ts'
import { ORDER } from '../api/types.ts'
import { StateBadge } from '../components/StateBadge.tsx'
import { layout } from '../graphLayout.ts'
import { useT } from '../i18n.tsx'
import type { GraphDto, GraphEdge, GraphNode, SporeKind } from '../api/types.ts'
import type { PlacedNode } from '../graphLayout.ts'
import type { StringKey } from '../../locales/en.ts'

const RADIUS = 22
const MARGIN = 40

function groupByKind(nodes: readonly PlacedNode[]): Record<SporeKind | 'unknown', PlacedNode[]> {
  const groups: Record<SporeKind | 'unknown', PlacedNode[]> = {
    hypha: [], rhiza: [], enzyme: [], inhibitor: [], unknown: [],
  }
  for (const node of nodes) groups[node.kind ?? 'unknown'].push(node)
  return groups
}

function GraphMark(
  { node, onOpen }: { node: PlacedNode, onOpen: (name: string) => void },
): React.JSX.Element {
  const dormant = node.state === 'dormant'
  return (
    <g
      transform={`translate(${node.x + MARGIN}, ${node.y + MARGIN})`}
      role="button"
      aria-label={node.name}
      tabIndex={0}
      className="cursor-pointer"
      onClick={() => { onOpen(node.name) }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onOpen(node.name) }}
    >
      <circle
        r={RADIUS}
        strokeWidth={2}
        className={dormant ? 'fill-crit-bg stroke-crit' : 'fill-ok-bg stroke-ok'}
      />
      <text textAnchor="middle" dy={RADIUS + 16} className="fill-text text-xs font-mono">
        {node.name}
      </text>
      {node.reason !== undefined && (
        <text textAnchor="middle" dy={RADIUS + 30} className="fill-crit text-[10px]">
          {node.reason}
        </text>
      )}
    </g>
  )
}

export function Graph(): React.JSX.Element {
  const t = useT()
  const navigate = useNavigate()
  const [graph, setGraph] = useState<GraphDto | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    api.get<GraphDto>('/api/graph').then(
      (g) => { setGraph(g); setError(false) },
      () => { setError(true) },
    )
  }, [])

  const nodes = readArray<GraphNode>(graph?.nodes) ?? []
  const names = new Set(nodes.map((n) => n.name))
  // An edge naming a node absent from `nodes` cannot be placed or drawn: drop it.
  const edges = (readArray<GraphEdge>(graph?.edges) ?? []).filter((e) => names.has(e.from) && names.has(e.to))

  const placed = layout({ nodes, edges })
  const byName = new Map(placed.map((n) => [n.name, n]))
  const width = placed.reduce((m, n) => Math.max(m, n.x), 0) + MARGIN * 2
  const height = placed.reduce((m, n) => Math.max(m, n.y), 0) + MARGIN * 2
  const grouped = groupByKind(placed)
  const openPlugin = (name: string): void => { void navigate(`/plugins/${name}`) }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-medium">{t('graph.title')}</h1>
      {error && <p role="alert" className="text-sm text-crit">{t('error.generic')}</p>}

      {graph !== null && placed.length === 0 && <p className="text-text/70">{t('graph.empty')}</p>}

      {placed.length > 0 && (
        <>
          <div data-testid="graph-desktop" className="hidden overflow-x-auto md:block">
            <svg role="img" aria-label={t('graph.title')} width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
              {edges.map((edge) => {
                const from = byName.get(edge.from)
                const to = byName.get(edge.to)
                if (from === undefined || to === undefined) return null
                const broken = from.state === 'dormant' || to.state === 'dormant'
                return (
                  <line
                    key={`${edge.from}-${edge.to}`}
                    x1={from.x + MARGIN}
                    y1={from.y + MARGIN}
                    x2={to.x + MARGIN}
                    y2={to.y + MARGIN}
                    strokeWidth={2}
                    className={broken ? 'stroke-idle' : 'stroke-line'}
                    strokeDasharray={edge.optional ? '6 4' : undefined}
                  />
                )
              })}
              {placed.map((node) => <GraphMark key={node.name} node={node} onOpen={openPlugin} />)}
            </svg>
          </div>

          <div data-testid="graph-mobile" className="space-y-6 md:hidden">
            {ORDER.filter((kind) => grouped[kind].length > 0).map((kind) => (
              <section key={kind} className="space-y-2" data-testid={`graph-kind-${kind}`}>
                <h2 className="font-medium">{t(`kind.${kind}` as StringKey)}</h2>
                <ul className="divide-y divide-line-soft rounded-lg border border-line">
                  {grouped[kind].map((node) => (
                    <li key={node.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                      <Link to={`/plugins/${node.name}`} className="font-mono">{node.name}</Link>
                      <StateBadge state={node.state} />
                      {node.reason !== undefined && (
                        <p className="w-full text-sm text-text/70">{node.reason}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
