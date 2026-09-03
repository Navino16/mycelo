import type { FastifyInstance } from 'fastify'
import type { SporeKind } from '@mycelo/septum'
import type { RuntimeState } from '../../boot/state.js'
import { listInstalls } from '../../config/store.js'
import { targetName } from '../../germination/anastomoses.js'
import type { Dormant, GerminatedEnzyme, GerminatedInhibitor, Registry } from '../../germination/registry.js'
import { aggregateHealth } from '../../supervision/health.js'

export interface CommandDto {
  plugin: string
  /** What a caller types: the alias when one is set (spec §3.5). */
  command: string
  /** As the manifest declares it, so the Roles screen can show what an alias renamed. */
  declared: string
  /** `<plugin>.<command>` — the pattern a role grants, not what a user types. */
  qualified: string
  /** Rendered, not a key: `CommandSpec.description` is required and is a catalogue key. */
  description: string
  capabilities: readonly string[]
}

/**
 * Grouped by plugin, matching §8's identical wording for `/api/plugins` — the Roles screen
 * renders one collapsible section per plugin. No `unknown` bucket: every command reaches
 * this route through `registry.routes`, which is indexed by plugin, so (unlike
 * `/api/plugins`, where a manifest can fail to parse before a kind is known) a command
 * with no plugin cannot exist here.
 */
export type CommandGroups = Record<string, readonly CommandDto[]>

function groupByPlugin(commands: readonly CommandDto[]): CommandGroups {
  const groups: Record<string, CommandDto[]> = {}
  for (const command of commands) {
    (groups[command.plugin] ??= []).push(command)
  }
  return groups
}

export interface GraphNode {
  name: string
  /** Absent only for a `registry.dormant` entry whose manifest never parsed. */
  kind?: SporeKind
  /**
   * Germination's own verdict, except for a rhiza that germinated and then stopped answering:
   * its live health state wins, which is what the Overview reads off /api/health (ruling F11).
   */
  state: 'germinated' | 'dormant' | 'degraded' | 'unreachable'
  reason?: string
}

// germinate.ts makes a spore named 'core' dormant rather than refusing it, so the synthetic
// node must win over it (nodesOf filters it out). Emitted always: it is the substrate, and
// 2k's five-column reading hangs off it (inventory §4).
const CORE_NODE = 'core'

export interface GraphEdge {
  from: string
  to: string
  optional: boolean
}

export interface GraphDto {
  nodes: readonly GraphNode[]
  edges: readonly GraphEdge[]
}

/**
 * `resolved` (registry.ts) only names what wired, not whether it was optional — that lives
 * in the raw `requires:` — so both are read together. An `any_of` group's chosen alternative
 * is always mandatory (anastomoses.ts never adds it to a non-mandatory edge); a target
 * reached by more than one requirement is optional only if every one of them is.
 */
function edgesOf(spore: GerminatedEnzyme | GerminatedInhibitor): readonly GraphEdge[] {
  const optionalOf = new Map<string, boolean>()
  const mark = (to: string, optional: boolean): void => {
    if (!spore.resolved.has(to)) return
    // 'mycelium' IS the core (anastomoses.ts puts it in `resolved`); the design's centre
    // column is that node, so it becomes an edge here rather than being dropped.
    const target = to === 'mycelium' ? CORE_NODE : to
    optionalOf.set(target, (optionalOf.get(target) ?? true) && optional)
  }
  for (const requirement of spore.manifest.requires ?? []) {
    if ('any_of' in requirement) {
      const chosen = requirement.any_of.map((a) => targetName(a.rhiza)).find((n) => spore.resolved.has(n))
      if (chosen !== undefined) mark(chosen, false)
    } else {
      mark(targetName(requirement.rhiza), requirement.optional)
    }
  }
  return [...optionalOf].map(([to, optional]) => ({ from: spore.name, to, optional }))
}

/**
 * The declared targets of a dormant spore, as edges. A dormant spore has no `resolved` set —
 * germination stopped before it wired anything — so the graph would otherwise draw no edge at
 * all for the one break it exists to show (ruling F9). An `any_of` group contributes its chosen
 * alternative alone; only a group that chose nothing offers all of them, and an alternative
 * nobody installed has no node.
 */
function dormantEdgesOf(dormant: Dormant, placed: ReadonlySet<string>): readonly GraphEdge[] {
  const optionalOf = new Map<string, boolean>()
  for (const requirement of dormant.requires ?? []) {
    const targets = requirement.chosen !== undefined && placed.has(requirement.chosen)
      ? [requirement.chosen]
      : requirement.targets
    for (const to of targets) {
      const target = to === 'mycelium' ? CORE_NODE : to
      if (!placed.has(target)) continue
      optionalOf.set(target, (optionalOf.get(target) ?? true) && requirement.optional)
    }
  }
  return [...optionalOf].map(([to, optional]) => ({ from: dormant.name, to, optional }))
}

// A dormant spore has no manifest in the registry; its install row recorded the kind at the
// manifest's first parse, so only a never-parsed spore stays kind-less (plan defect 29).
function nodesOf(
  registry: Registry,
  recordedKind: ReadonlyMap<string, SporeKind>,
  unhealthy: ReadonlyMap<string, { state: 'degraded' | 'unreachable', detail?: string }>,
): readonly GraphNode[] {
  return [
    { name: CORE_NODE, state: 'germinated' },
    ...registry.hyphae.map((s): GraphNode => ({ name: s.name, kind: s.manifest.kind, state: 'germinated' })),
    ...registry.rhizas.map((s): GraphNode => {
      const failing = unhealthy.get(s.name)
      return {
        name: s.name,
        kind: s.manifest.kind,
        state: failing?.state ?? 'germinated',
        ...(failing?.detail === undefined ? {} : { reason: failing.detail }),
      }
    }),
    ...registry.enzymes.map((s): GraphNode => ({ name: s.name, kind: s.manifest.kind, state: 'germinated' })),
    ...registry.inhibitors.map((s): GraphNode => ({ name: s.name, kind: s.manifest.kind, state: 'germinated' })),
    // A spore deliberately named 'core' is dormant, not absent: two nodes of that name
    // duplicate a React key, collapse in `byName` and either dash every core edge amber or
    // hide the dormancy. The substrate's own node wins.
    ...registry.dormant.filter((d) => d.name !== CORE_NODE).map((d): GraphNode => ({
      name: d.name,
      ...(recordedKind.has(d.name) ? { kind: recordedKind.get(d.name) } : {}),
      state: 'dormant',
      reason: d.reason,
    })),
  ]
}

export function registerRegistryRoutes(app: FastifyInstance, state: RuntimeState): void {
  app.get('/api/commands', (request) => {
    // Nothing germinated while 'starting' or 'degraded', so there are no commands to grant
    // and no distinction between the two matters here (spec §4.1).
    if (state.germination.status !== 'germinated') return {}
    const { registry } = state.germination.mycelium
    const commands = [...registry.routes.values()].map((route): CommandDto => ({
      plugin: route.plugin,
      command: route.command,
      declared: route.declared,
      qualified: route.qualified,
      description: state.translator.translate(route.plugin, route.spec.description, request.locale),
      capabilities: route.spec.capabilities ?? [],
    }))
    return groupByPlugin(commands)
  })

  app.get('/api/graph', async (): Promise<GraphDto> => {
    if (state.germination.status !== 'germinated') return { nodes: [], edges: [] }
    const { registry } = state.germination.mycelium
    // The same probe /api/health runs, so both screens read one verdict per fetch — the graph
    // fetches once per mount and the health poll every 15 s, so they still age apart.
    const unhealthy = new Map((await aggregateHealth(registry))
      .filter((h) => h.status.state !== 'healthy')
      .map((h) => [h.rhiza, {
        // aggregateHealth returns the plugin's own answer unvalidated: anything but the two
        // known faults reads as unreachable, collapsed the way Overview.tsx already does it.
        state: h.status.state === 'degraded' ? 'degraded' as const : 'unreachable' as const,
        ...(h.status.detail === undefined ? {} : { detail: h.status.detail }),
      }]))
    const recordedKind = new Map(listInstalls(state.db).map((i) => [i.name, i.kind as SporeKind]))
    const nodes = nodesOf(registry, recordedKind, unhealthy)
    const placed = new Set(nodes.map((n) => n.name))
    const edges = [
      ...[...registry.enzymes, ...registry.inhibitors].flatMap(edgesOf),
      ...registry.dormant.flatMap((d) => dormantEdgesOf(d, placed)),
    ]
    return { nodes, edges }
  })
}
