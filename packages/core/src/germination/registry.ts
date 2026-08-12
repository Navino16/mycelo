import type { CommandSpec, Enzyme, Hypha, Manifest, MyceliumScope, Rhiza } from '@mycelo/septum'

export interface GerminatedHypha {
  name: string
  manifest: Extract<Manifest, { kind: 'hypha' }>
  instance: Hypha
}

export interface GerminatedEnzyme {
  name: string
  manifest: Extract<Manifest, { kind: 'enzyme' }>
  instance: Enzyme | null
  /** This spore's own resolved set (anastomoses.ts), for ctx.rhiza()/ctx.has(). */
  resolved: ReadonlySet<string>
  scopes: readonly MyceliumScope[]
}

export interface GerminatedRhiza {
  name: string
  manifest: Extract<Manifest, { kind: 'rhiza' }>
  instance: Rhiza
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
  spec: CommandSpec
  enzyme: GerminatedEnzyme
}

export class CollisionError extends Error {
  readonly command: string
  readonly plugins: readonly string[]
  constructor(command: string, plugins: readonly string[]) {
    const message = plugins[0] === plugins[1]
      ? `command '${command}' is declared twice by '${plugins[0]}'`
      : `command '${command}' is declared by ${plugins.join(' and ')}`
    super(message)
    this.name = 'CollisionError'
    this.command = command
    this.plugins = plugins
  }
}

export interface Registry {
  hyphae: readonly GerminatedHypha[]
  enzymes: readonly GerminatedEnzyme[]
  rhizas: readonly GerminatedRhiza[]
  dormant: readonly Dormant[]
  routes: ReadonlyMap<string, CommandRoute>
  /** Names of germinated rhizas and enzymes only, dependency-first (anastomoses.ts). */
  order: readonly string[]
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
        spec,
        enzyme,
      })
    }
  }
  return routes
}
