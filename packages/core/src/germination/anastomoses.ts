import type { MyceliumScope, Requirement } from '@mycelo/septum'
import type { Dormant } from './registry.js'
import type { ReadManifest } from './manifest.js'

export const MOUNTABLE_SCOPES: readonly MyceliumScope[] = ['plugins.read', 'health.read', 'messages.send']

// Every scope MYCELIUM_SCOPES carries that MOUNTABLE_SCOPES does not yet mount, and the
// phase it arrives in. Adding a scope in phase 4 is then one line here.
const SCOPE_PHASE: Partial<Record<MyceliumScope, number>> = {
  'principals.read': 4,
  'principals.manage': 4,
  'roles.read': 4,
  'roles.assign': 4,
  'roles.manage': 4,
  'plugins.toggle': 4,
}

export interface ResolvedSpore {
  read: ReadManifest
  resolved: ReadonlySet<string>
  scopes: readonly MyceliumScope[]
}

export interface Resolution {
  order: readonly ResolvedSpore[]
  dormant: readonly Dormant[]
}

export class CycleError extends Error {
  readonly cycle: readonly string[]
  constructor(cycle: readonly string[]) {
    super(`cycle: ${[...cycle, cycle[0]].join(' -> ')}`)
    this.name = 'CycleError'
    this.cycle = cycle
  }
}

// A target may carry a semver range ("radarr@^2"); split on the first "@" and match on
// the name only. Range checking is phase 8's problem, once spores carry versions.
function targetName(target: string): string {
  const at = target.indexOf('@')
  return at === -1 ? target : target.slice(0, at)
}

interface Evaluated {
  edges: readonly string[]
  mandatoryEdges: readonly string[]
  scopes: readonly MyceliumScope[]
  // mycelium always resolves and belongs in ctx.has(), but declares nothing itself and
  // so is never a graph edge (core spec §6, last paragraph) — tracked separately from edges.
  usesMycelium: boolean
  dormantReason?: string
}

const FAILED: Evaluated = { edges: [], mandatoryEdges: [], scopes: [], usesMycelium: false }

/**
 * Resolves one manifest's requirements against the installed set alone (no re-collapse):
 * any_of first, then mandatory-target existence, then mycelium scopes — spec §6 order.
 */
function evaluate(requires: readonly Requirement[], installed: ReadonlySet<string>): Evaluated {
  const edges: string[] = []
  const mandatoryEdges: string[] = []
  let usesMycelium = false

  for (const requirement of requires) {
    if ('any_of' in requirement) {
      const alternatives = requirement.any_of.map((a) => targetName(a.rhiza))
      const chosen = alternatives.find((n) => n === 'mycelium' || installed.has(n))
      if (chosen === undefined) {
        const listed = alternatives.map((n) => `'${n}'`).join(', ')
        return { ...FAILED, dormantReason: `requires one of rhiza ${listed} — none is installed` }
      }
      if (chosen === 'mycelium') {
        usesMycelium = true
      } else {
        edges.push(chosen)
        mandatoryEdges.push(chosen)
      }
      continue
    }
    const name = targetName(requirement.rhiza)
    if (name === 'mycelium') {
      usesMycelium = true
      continue // scopes checked below, once every target has resolved
    }
    if (installed.has(name)) {
      edges.push(name)
      if (!requirement.optional) mandatoryEdges.push(name)
    } else if (!requirement.optional) {
      return { ...FAILED, dormantReason: `requires rhiza '${name}', which is not installed` }
    }
  }

  const scopes: MyceliumScope[] = []
  for (const requirement of requires) {
    if ('any_of' in requirement || targetName(requirement.rhiza) !== 'mycelium') continue
    for (const scope of requirement.scopes ?? []) {
      if (!MOUNTABLE_SCOPES.includes(scope)) {
        const phase = SCOPE_PHASE[scope] ?? 4
        return { ...FAILED, dormantReason: `requires mycelium scope '${scope}', which arrives in phase ${phase}` }
      }
      scopes.push(scope)
    }
  }

  return { edges, mandatoryEdges, scopes: [...new Set(scopes)], usesMycelium }
}

interface AliveNode {
  read: ReadManifest
  edges: readonly string[]
  mandatoryEdges: readonly string[]
  scopes: readonly MyceliumScope[]
  usesMycelium: boolean
}

/** DFS with a visiting/done coloring: finds a cycle if one exists, else a dependency-first order. */
function orderOrThrow(alive: ReadonlyMap<string, AliveNode>): string[] {
  const state = new Map<string, 'visiting' | 'done'>()
  const stack: string[] = []
  const order: string[] = []

  function visit(name: string): void {
    if (state.get(name) === 'done') return
    if (state.get(name) === 'visiting') {
      throw new CycleError(stack.slice(stack.indexOf(name)))
    }
    state.set(name, 'visiting')
    stack.push(name)
    const node = alive.get(name)
    if (node !== undefined) {
      for (const dep of node.edges) {
        if (alive.has(dep)) visit(dep)
      }
    }
    stack.pop()
    state.set(name, 'done')
    order.push(name)
  }

  for (const name of alive.keys()) visit(name)
  return order
}

export function resolve(reads: readonly ReadManifest[]): Resolution {
  const dormant: Dormant[] = []

  // Step 1: duplicate names. The first occurrence claims the name; the rest go dormant
  // and never enter the candidate pool, so nothing can depend on them.
  const candidates = new Map<string, ReadManifest>()
  for (const read of reads) {
    const name = read.manifest.name
    // 'mycelium' is the implicit core rhiza (spec §6.1): a spore claiming it would
    // shadow every `rhiza: mycelium` requirement, which still resolves to the core and
    // produces no edge — this module is the only place that knows the name is implicit.
    if (name === 'mycelium') {
      dormant.push({ name, reason: "the name 'mycelium' is reserved for the core" })
      continue
    }
    const claimant = candidates.get(name)
    if (claimant !== undefined) {
      dormant.push({
        name,
        reason: `name '${name}' is already claimed by the spore at '${claimant.location.directory}' (duplicate at '${read.location.directory}')`,
      })
      continue
    }
    candidates.set(name, read)
  }

  // Steps 2-4: any_of collapse, mandatory targets, scopes — per candidate, in that
  // priority, against the installed set alone.
  const installed = new Set(candidates.keys())
  const primaryReasons = new Map<string, string>()
  const alive = new Map<string, AliveNode>()
  for (const [name, read] of candidates) {
    const evaluated = evaluate(read.manifest.requires ?? [], installed)
    if (evaluated.dormantReason !== undefined) {
      primaryReasons.set(name, evaluated.dormantReason)
      continue
    }
    alive.set(name, {
      read,
      edges: evaluated.edges,
      mandatoryEdges: evaluated.mandatoryEdges,
      scopes: evaluated.scopes,
      usesMycelium: evaluated.usesMycelium,
    })
  }

  // Step 5: transitive dormancy, as a fixpoint over mandatory edges only. A genuine
  // cycle never resolves here — both sides stay alive, for step 6 to catch.
  const reasons = new Map(primaryReasons)
  let changed = true
  while (changed) {
    changed = false
    for (const [name, node] of alive) {
      if (reasons.has(name)) continue
      const cause = node.mandatoryEdges.find((dep) => reasons.has(dep))
      if (cause !== undefined) {
        reasons.set(name, `requires rhiza '${cause}', which is dormant: ${reasons.get(cause)}`)
        changed = true
      }
    }
  }

  const survivors = new Map<string, AliveNode>()
  for (const [name, node] of alive) {
    const reason = reasons.get(name)
    if (reason !== undefined) dormant.push({ name, reason })
    else survivors.set(name, node)
  }
  for (const [name, reason] of primaryReasons) dormant.push({ name, reason })

  // Steps 6-7: cycle detection and topological order, over survivors only — an edge
  // to a dormant optional dependency is simply dropped, not a cycle participant.
  const names = orderOrThrow(survivors)

  const order: ResolvedSpore[] = names.map((name) => {
    const node = survivors.get(name)
    if (node === undefined) throw new Error(`unreachable: '${name}' ordered but not a survivor`)
    const resolved = node.edges.filter((dep) => survivors.has(dep))
    if (node.usesMycelium) resolved.push('mycelium')
    return { read: node.read, resolved: new Set(resolved), scopes: node.scopes }
  })

  return { order, dormant }
}
