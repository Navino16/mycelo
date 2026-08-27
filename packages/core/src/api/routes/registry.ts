import type { FastifyInstance } from 'fastify'
import type { SporeKind } from '@mycelo/septum'
import type { RuntimeState } from '../../boot/state.js'
import { targetName } from '../../germination/anastomoses.js'
import type { GerminatedEnzyme, GerminatedInhibitor, Registry } from '../../germination/registry.js'

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
  state: 'germinated' | 'dormant'
  reason?: string
}

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
    if (to === 'mycelium' || !spore.resolved.has(to)) return
    optionalOf.set(to, (optionalOf.get(to) ?? true) && optional)
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

function nodesOf(registry: Registry): readonly GraphNode[] {
  return [
    ...registry.hyphae.map((s): GraphNode => ({ name: s.name, kind: s.manifest.kind, state: 'germinated' })),
    ...registry.rhizas.map((s): GraphNode => ({ name: s.name, kind: s.manifest.kind, state: 'germinated' })),
    ...registry.enzymes.map((s): GraphNode => ({ name: s.name, kind: s.manifest.kind, state: 'germinated' })),
    ...registry.inhibitors.map((s): GraphNode => ({ name: s.name, kind: s.manifest.kind, state: 'germinated' })),
    ...registry.dormant.map((d): GraphNode => ({ name: d.name, state: 'dormant', reason: d.reason })),
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

  app.get('/api/graph', (): GraphDto => {
    if (state.germination.status !== 'germinated') return { nodes: [], edges: [] }
    const { registry } = state.germination.mycelium
    const edges = [...registry.enzymes, ...registry.inhibitors].flatMap(edgesOf)
    return { nodes: nodesOf(registry), edges }
  })
}
