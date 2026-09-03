import type { CommandSpec, Enzyme, Hypha, Inhibitor, Manifest, MyceliumScope, Rhiza } from '@mycelo/septum'
import type { Catalogs } from '../i18n/catalog.js'

export interface GerminatedHypha {
  name: string
  manifest: Extract<Manifest, { kind: 'hypha' }>
  instance: Hypha
  /** Validated against the module's own configSchema during germination. */
  config: unknown
}

export interface GerminatedEnzyme {
  name: string
  manifest: Extract<Manifest, { kind: 'enzyme' }>
  instance: Enzyme | null
  /** This spore's own resolved set (anastomoses.ts), for ctx.rhiza()/ctx.has(). */
  resolved: ReadonlySet<string>
  scopes: readonly MyceliumScope[]
  /** Validated against the module's own configSchema during germination. */
  config: unknown
}

export interface GerminatedRhiza {
  name: string
  manifest: Extract<Manifest, { kind: 'rhiza' }>
  instance: Rhiza
  /** Validated against the module's own configSchema during germination. */
  config: unknown
}

export interface GerminatedInhibitor {
  name: string
  manifest: Extract<Manifest, { kind: 'inhibitor' }>
  instance: Inhibitor
  /** This spore's own resolved set (anastomoses.ts), for ctx.rhiza()/ctx.has(). */
  resolved: ReadonlySet<string>
  scopes: readonly MyceliumScope[]
  /** Validated against the module's own configSchema during germination. */
  config: unknown
}

/** One `requires:` entry of a dormant spore, flattened: every alternative of an `any_of`. */
export interface DormantRequirement {
  targets: readonly string[]
  optional: boolean
}

export interface Dormant {
  name: string
  reason: string
  /**
   * The targets its manifest declared, absent when the manifest never parsed. A dormant spore
   * has no manifest here and no `resolved`, so this is the only record of the dependency that
   * broke — the one edge /api/graph exists to draw (ruling F9).
   */
  requires?: readonly DormantRequirement[]
}

/** Which enzyme answers a command, and under which plugin it is authorized. */
export interface CommandRoute {
  /** What a caller types: the alias when one is set, the manifest name otherwise. */
  command: string
  plugin: string
  /** As the manifest declares it, so a help surface can say what an alias renamed. */
  declared: string
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
  inhibitors: readonly GerminatedInhibitor[]
  dormant: readonly Dormant[]
  routes: ReadonlyMap<string, CommandRoute>
  /** Names of germinated rhizas and enzymes only, dependency-first (anastomoses.ts). */
  order: readonly string[]
  /** Enforcing inhibitors that did not germinate. Any one of them refuses all traffic (design §7). */
  brokenEnforcing: readonly string[]
  /** One entry per germinated spore that ships a translations/ directory (design §3). */
  catalogs: Catalogs
}

/**
 * Indexes commands by the name a caller types — the alias when `aliases` holds one for
 * `plugin.command`, the manifest name otherwise. A collision still halts germination: an
 * alias resolves one, it does not suppress the check (spec §3.3).
 */
export function buildRoutes(
  enzymes: readonly GerminatedEnzyme[],
  aliases: ReadonlyMap<string, string>,
): Map<string, CommandRoute> {
  const routes = new Map<string, CommandRoute>()
  for (const enzyme of enzymes) {
    for (const spec of enzyme.manifest.commands) {
      const qualified = `${enzyme.name}.${spec.name}`
      const command = aliases.get(qualified) ?? spec.name
      const existing = routes.get(command)
      if (existing !== undefined) {
        throw new CollisionError(command, [existing.plugin, enzyme.name])
      }
      routes.set(command, {
        command,
        plugin: enzyme.name,
        declared: spec.name,
        qualified,
        spec,
        enzyme,
      })
    }
  }
  return routes
}
