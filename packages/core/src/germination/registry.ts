import type { Enzyme, Hypha, Manifest } from '@mycelo/septum'

export interface GerminatedHypha {
  name: string
  manifest: Extract<Manifest, { kind: 'hypha' }>
  instance: Hypha
}

export interface GerminatedEnzyme {
  name: string
  manifest: Extract<Manifest, { kind: 'enzyme' }>
  instance: Enzyme
}

export interface Dormant {
  name: string
  reason: string
}

/** Which enzyme answers a command, and under which plugin it is authorized. */
export interface CommandRoute {
  command: string
  plugin: string
  /** `<plugin>.<command>` — the authorization identifier, not what a user types. */
  qualified: string
  enzyme: GerminatedEnzyme
}

export class CollisionError extends Error {
  readonly command: string
  readonly plugins: readonly string[]
  constructor(command: string, plugins: readonly string[]) {
    super(`command '${command}' is declared by ${plugins.join(' and ')}`)
    this.name = 'CollisionError'
    this.command = command
    this.plugins = plugins
  }
}

export interface Registry {
  hyphae: readonly GerminatedHypha[]
  enzymes: readonly GerminatedEnzyme[]
  dormant: readonly Dormant[]
  routes: ReadonlyMap<string, CommandRoute>
}

/**
 * Indexes commands by short name. A collision halts germination (spec §8) — it cannot
 * be resolved here, only by an alias set in the UI, which phase 5 adds.
 */
export function buildRoutes(enzymes: readonly GerminatedEnzyme[]): Map<string, CommandRoute> {
  const routes = new Map<string, CommandRoute>()
  for (const enzyme of enzymes) {
    for (const spec of enzyme.manifest.commands) {
      const existing = routes.get(spec.name)
      if (existing !== undefined) {
        throw new CollisionError(spec.name, [existing.plugin, enzyme.name])
      }
      routes.set(spec.name, {
        command: spec.name,
        plugin: enzyme.name,
        qualified: `${enzyme.name}.${spec.name}`,
        enzyme,
      })
    }
  }
  return routes
}
