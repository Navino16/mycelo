import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { api } from '../api/client.ts'
import { readArray } from '../api/read.ts'
import { ORDER } from '../api/types.ts'
import { Chip } from '../components/Chip.tsx'
import { Dot } from '../components/Dot.tsx'
import { EmptyState } from '../components/EmptyState.tsx'
import { StateBadge } from '../components/StateBadge.tsx'
import { TONE_CLASSES } from '../components/tone.ts'
import { BOX_H, BOX_W, isBroken, isFailing, layout } from '../graphLayout.ts'
import { useT } from '../i18n.tsx'
import type { GraphDto, GraphEdge, GraphNode, SporeKind } from '../api/types.ts'
import type { PlacedNode } from '../graphLayout.ts'
import type { StringKey } from '../../locales/en.ts'

/** The substrate is drawn narrower than a plugin, as design 2k draws it. */
const CORE_W = 96
const MARGIN = 24
/** Advance of one 12 px mono character, and where a label starts inside its box. */
const MONO_ADVANCE = 7.2
const LABEL_X = 24
// A Zod refusal runs to hundreds of characters; the node shows a prefix, <title> the whole (defect 30).
const REASON_CHARS = 48
/** Both derived from the advance, so neither the reason clips nor the name overruns its box. */
const REASON_W = Math.ceil(REASON_CHARS * MONO_ADVANCE)
const NAME_CHARS = Math.floor((BOX_W - LABEL_X * 2) / MONO_ADVANCE)

function widthOf(node: GraphNode): number {
  return node.name === 'core' ? CORE_W : BOX_W
}

function clip(text: string, chars: number): string {
  return text.length > chars ? `${text.slice(0, chars - 1)}…` : text
}

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
  // R1: a failure is amber on every surface, the graph included.
  const ink = isFailing(node) ? 'var(--color-warn)' : 'var(--color-ok)'
  const tint = isFailing(node) ? 'var(--color-warn-bg)' : 'var(--color-ok-bg)'
  return (
    <g
      transform={`translate(${node.x + MARGIN}, ${node.y + MARGIN})`}
      role="button"
      aria-label={node.name}
      tabIndex={0}
      data-node={node.name}
      className="cursor-pointer"
      onClick={() => { onOpen(node.name) }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onOpen(node.name) }}
    >
      <rect width={widthOf(node)} height={BOX_H} rx={8} stroke={ink} fill={tint} />
      <circle cx={11} cy={BOX_H / 2} r={3.5} fill={ink} />
      <text
        x={LABEL_X}
        y={BOX_H / 2}
        dominantBaseline="middle"
        fill="var(--color-text)"
        className="text-[12px] font-mono"
      >
        {clip(node.name, NAME_CHARS)}
      </text>
      {node.reason !== undefined && (
        <>
          <title>{node.reason}</title>
          <text
            data-reason={node.name}
            y={BOX_H + 15}
            fill="var(--color-warn)"
            className="text-[12px] font-mono"
          >
            {clip(node.reason, REASON_CHARS)}
          </text>
        </>
      )}
    </g>
  )
}

export function Graph(): React.JSX.Element {
  const t = useT()
  const navigate = useNavigate()
  const [graph, setGraph] = useState<GraphDto | null>(null)
  const [error, setError] = useState(false)
  const [onlyFailures, setOnlyFailures] = useState(false)

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
  const failing = new Set(placed.filter(isFailing).map((n) => n.name))
  const shownEdges = onlyFailures
    ? edges.filter((e) => failing.has(e.from) || failing.has(e.to))
    : edges
  // A break is only readable with both its ends on screen, so the intact end stays.
  const shownNodes = onlyFailures
    ? placed.filter((n) => failing.has(n.name)
      || shownEdges.some((e) => e.from === n.name || e.to === n.name))
    : placed

  const width = shownNodes.reduce(
    (m, n) => Math.max(m, n.x + (n.reason === undefined ? widthOf(n) : REASON_W)), 0,
  ) + MARGIN * 2
  const height = shownNodes.reduce((m, n) => Math.max(m, n.y), 0) + BOX_H + MARGIN * 2
  // The substrate is not a plugin: it has no kind, and the phone's list is grouped by kind.
  const grouped = groupByKind(shownNodes.filter((n) => n.name !== 'core'))
  const openPlugin = (name: string): void => { void navigate(`/plugins/${name}`) }
  const summary = t('graph.summary', {
    plugins: placed.filter((n) => n.name !== 'core').length,
    links: edges.length,
    broken: edges.filter((e) => isBroken(e, byName)).length,
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-page font-semibold">{t('graph.title')}</h1>
          {placed.length > 0 && <p className="text-meta-lg text-text/60">{summary}</p>}
        </div>
        {placed.length > 0 && (
          <div className="hidden items-center gap-4 text-meta-lg text-text/70 md:flex">
            <span className="flex items-center gap-2"><Dot tone="ok" />{t('graph.legendGerminated')}</span>
            <span className="flex items-center gap-2"><Dot tone="warn" />{t('graph.legendDormant')}</span>
            <span className="flex items-center gap-2">
              <svg aria-hidden="true" width={16} height={2}>
                <line
                  x1={0}
                  y1={1}
                  x2={16}
                  y2={1}
                  strokeWidth={2}
                  stroke="var(--color-warn)"
                  strokeDasharray="4 3"
                />
              </svg>
              {t('graph.legendBroken')}
            </span>
            <Chip
              label={t('graph.onlyFailures')}
              active={onlyFailures}
              onClick={() => { setOnlyFailures(!onlyFailures) }}
            />
          </div>
        )}
      </div>

      {error && <p role="alert" className={`text-body ${TONE_CLASSES.warn.text}`}>{t('error.generic')}</p>}

      {graph !== null && placed.length === 0 && (
        <EmptyState title={t('graph.emptyTitle')} body={t('graph.empty')} />
      )}

      {placed.length > 0 && (
        <>
          <div
            data-testid="graph-desktop"
            className="hidden space-y-2 rounded-xl border border-line bg-surface p-4 md:block"
          >
            <div className="overflow-x-auto">
              <svg role="img" aria-label={t('graph.title')} width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
                {shownEdges.map((edge) => {
                  const from = byName.get(edge.from)
                  const to = byName.get(edge.to)
                  if (from === undefined || to === undefined) return null
                  const broken = isBroken(edge, byName)
                  const rightward = from.x < to.x
                  return (
                    <line
                      key={`${edge.from}-${edge.to}`}
                      data-edge={`${edge.from}->${edge.to}`}
                      x1={MARGIN + (rightward ? from.x + widthOf(from) : from.x)}
                      y1={MARGIN + from.y + BOX_H / 2}
                      x2={MARGIN + (rightward ? to.x : to.x + widthOf(to))}
                      y2={MARGIN + to.y + BOX_H / 2}
                      strokeWidth={2}
                      stroke={broken ? 'var(--color-warn)' : 'var(--color-line)'}
                      strokeDasharray={broken ? '6 4' : undefined}
                      // An intact optional link is not a failure: quieter, and never dashed.
                      opacity={edge.optional && !broken ? 0.6 : undefined}
                    />
                  )
                })}
                {shownNodes.map((node) => <GraphMark key={node.name} node={node} onOpen={openPlugin} />)}
              </svg>
            </div>
            <p className="text-right font-mono text-meta text-text/50">{t('graph.reading')}</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <section className="space-y-2 rounded-xl border border-line bg-surface p-4">
              <h2 className="text-title font-medium">{t('graph.readingBreakTitle')}</h2>
              <p className="text-body text-text/70">{t('graph.readingBreak')}</p>
            </section>
            <section className="space-y-2 rounded-xl border border-line bg-surface p-4">
              <h2 className="text-title font-medium">{t('graph.desktopOnlyTitle')}</h2>
              <p className="text-body text-text/70">{t('graph.desktopOnly')}</p>
            </section>
          </div>

          <div data-testid="graph-mobile" className="space-y-6 md:hidden">
            {ORDER.filter((kind) => grouped[kind].length > 0).map((kind) => (
              <section key={kind} className="space-y-2" data-testid={`graph-kind-${kind}`}>
                <h2 className="text-title font-medium">{t(`kind.${kind}` as StringKey)}</h2>
                <ul className="divide-y divide-line-soft rounded-lg border border-line">
                  {grouped[kind].map((node) => (
                    <li key={node.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                      <Link to={`/plugins/${node.name}`} className="font-mono text-body">{node.name}</Link>
                      <StateBadge state={node.state} />
                      {node.reason !== undefined && (
                        <p className="w-full text-body text-text/70">{node.reason}</p>
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
