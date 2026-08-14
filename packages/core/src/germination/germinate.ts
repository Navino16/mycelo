import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Enzyme, Hypha, Inhibitor, Logger, Rhiza } from '@mycelo/septum'
import { getInstall } from '../config/store.js'
import { loadCatalogs } from '../i18n/catalog.js'
import type { LocaleMessages } from '../i18n/catalog.js'
import type { Db } from '../persistence/db.js'
import { resolve } from './anastomoses.js'
import { discover } from './discover.js'
import { loadModule } from './load.js'
import { isFailure, readManifest } from './manifest.js'
import type { ReadManifest } from './manifest.js'
import { buildRoutes } from './registry.js'
import type { Dormant, GerminatedEnzyme, GerminatedHypha, GerminatedInhibitor, GerminatedRhiza, Registry } from './registry.js'
import { capabilityShapeError, enzymeShapeError, hyphaShapeError, inhibitorShapeError, rhizaShapeError, unreferencedHandlers } from './shape.js'

/**
 * Walks the spores directory, resolves dependencies, then loads only the survivors in
 * topological order. A spore that fails goes dormant with a reason; only a command
 * collision halts the whole phase (spec §8). CycleError propagates out untouched.
 */
export async function germinate(
  sporesDir: string,
  logger: Logger,
  pluginConfig: Readonly<Record<string, unknown>> = {},
  db?: Db,
): Promise<Registry> {
  // A missing directory and a missing config file both resolve quietly to defaults
  // (spec-compliant on their own), but their combination — run from the wrong cwd —
  // produced "germinated 0 spores" and exit 0 with no word said. Not a crash, but not
  // legible either.
  if (!existsSync(sporesDir)) {
    logger.warn(`spores directory does not exist: '${sporesDir}' — nothing will germinate`)
  }

  const reads: ReadManifest[] = []
  const dormant: Dormant[] = []
  // Design §7: an enforcing inhibitor that fails to germinate must still refuse all
  // traffic. Only germinate() holds both facts at once — the manifest and the dormancy.
  const brokenEnforcing: string[] = []
  for (const location of discover(sporesDir)) {
    const read = readManifest(location)
    if (isFailure(read)) {
      // Matched on the directory, the identity listPlugins() and findSpore() already use
      // for a spore with no parseable manifest. Without this, a YAML typo in a disabled
      // enforcing inhibitor refuses all traffic, and admission runs before parsing — so
      // /plugin-disable cannot undo what it says it already did.
      if (db !== undefined && getInstall(db, location.directory)?.enabled === false) continue
      dormant.push({ name: location.directory, reason: read.reason })
      // No validated name to report: the directory is all a failed manifest leaves.
      if (read.enforcingInhibitor) brokenEnforcing.push(location.directory)
    } else {
      if (db !== undefined) {
        const install = getInstall(db, read.manifest.name)
        // Absent or disabled is a choice, not a failure: dormant would report it as breakage.
        if (install === null || !install.enabled) continue
      }
      reads.push(read)
    }
  }

  const resolution = resolve(reads)
  dormant.push(...resolution.dormant)

  const hyphae: GerminatedHypha[] = []
  const enzymes: GerminatedEnzyme[] = []
  const rhizas: GerminatedRhiza[] = []
  const inhibitors: GerminatedInhibitor[] = []
  // Names that went dormant during this walk — resolve() cannot see a module-load or
  // shape failure, so a dependent's `mandatory`/`resolved` sets may still name one that
  // just failed.
  const failed = new Map<string, string>()
  const catalogs = new Map<string, LocaleMessages>()

  for (const spore of resolution.order) {
    const { manifest } = spore.read
    const markBroken = (): void => {
      if (manifest.kind === 'inhibitor' && manifest.enforcing) brokenEnforcing.push(manifest.name)
    }
    // design §3: the runtime owns these two domains, and a spore taking either would
    // replace the bot's own refusal sentences.
    if (manifest.name === 'core' || manifest.name === 'common') {
      const reason = `'${manifest.name}' is a reserved translation domain`
      dormant.push({ name: manifest.name, reason })
      failed.set(manifest.name, reason)
      markBroken()
      continue
    }
    const cause = [...spore.mandatory].find((name) => failed.has(name))
    if (cause !== undefined) {
      // No re-collapse (design §2.2); if the cause was an any_of choice, the message
      // names the untried alternatives alongside it.
      const anyOf = spore.anyOf.find((choice) => choice.chosen === cause)
      const reason = anyOf !== undefined
        ? `requires one of rhiza ${anyOf.alternatives.map((n) => `'${n}'`).join(', ')}; '${cause}' was chosen and is dormant: ${failed.get(cause)}`
        : `requires rhiza '${cause}', which is dormant: ${failed.get(cause)}`
      dormant.push({ name: manifest.name, reason })
      failed.set(manifest.name, reason)
      markBroken()
      continue
    }
    // An optional dependency that turned out dormant is not this spore's problem (core
    // spec §6.3): drop it from `resolved` so ctx.has() answers false rather than lying.
    spore.resolved = new Set([...spore.resolved].filter((name) => !failed.has(name)))
    // Checked before loadModule (design §7.1). Held locally, not committed to `catalogs`
    // until the spore fully germinates: a later module-load or shape failure must not
    // leave a dormant spore's catalogue behind.
    let catalog: LocaleMessages = new Map()
    try {
      catalog = loadCatalogs(join(spore.read.location.path, 'translations'))
    } catch (e) {
      const reason = (e as Error).message
      dormant.push({ name: manifest.name, reason })
      failed.set(manifest.name, reason)
      markBroken()
      continue
    }
    try {
      const module = await loadModule(spore.read)
      let instance: unknown = null
      let config: unknown = {}
      if (module !== null) {
        if (module.configSchema !== undefined) {
          const declared = pluginConfig[manifest.name] ?? {}
          // Duck-typed, never instanceof: a spore is bundled with its own copy of Zod.
          const parsed = module.configSchema.safeParse(declared)
          if (!parsed.success) {
            const reason = `configuration rejected: ${String(parsed.error)}`
            dormant.push({ name: manifest.name, reason })
            failed.set(manifest.name, reason)
            markBroken()
            continue
          }
          config = parsed.data
        }
        instance = module.create()
        if (manifest.kind === 'hypha') {
          const problem = hyphaShapeError(instance, manifest.kind) ?? capabilityShapeError(instance as Record<string, unknown>, manifest)
          if (problem !== null) {
            dormant.push({ name: manifest.name, reason: problem })
            failed.set(manifest.name, problem)
            continue
          }
        } else if (manifest.kind === 'rhiza') {
          const problem = rhizaShapeError(instance)
          if (problem !== null) {
            dormant.push({ name: manifest.name, reason: problem })
            failed.set(manifest.name, problem)
            continue
          }
        } else if (manifest.kind === 'inhibitor') {
          const problem = inhibitorShapeError(instance)
          if (problem !== null) {
            dormant.push({ name: manifest.name, reason: problem })
            failed.set(manifest.name, problem)
            markBroken()
            continue
          }
        } else {
          const problem = enzymeShapeError(instance, manifest.commands)
          if (problem !== null) {
            dormant.push({ name: manifest.name, reason: problem })
            failed.set(manifest.name, problem)
            continue
          }
          const enzyme = instance as Enzyme
          const unreferenced = unreferencedHandlers(enzyme, manifest.commands)
          const handlerCount = Object.keys(enzyme.handlers).length
          if (unreferenced.length > 0 && unreferenced.length === handlerCount) {
            logger.warn(`spore '${manifest.name}' declares no handler any command references: the module is unreachable`)
          } else if (unreferenced.length > 0) {
            logger.warn(`spore '${manifest.name}' declares a handler no command references: ${unreferenced.join(', ')}`)
          }
        }
      }
      if (catalog.size > 0) catalogs.set(manifest.name, catalog)
      if (manifest.kind === 'hypha') {
        hyphae.push({ name: manifest.name, manifest, instance: instance as Hypha, config })
      } else if (manifest.kind === 'rhiza') {
        rhizas.push({ name: manifest.name, manifest, instance: instance as Rhiza, config })
      } else if (manifest.kind === 'inhibitor') {
        inhibitors.push({
          name: manifest.name,
          manifest,
          instance: instance as Inhibitor,
          resolved: spore.resolved,
          scopes: spore.scopes,
          config,
        })
      } else {
        enzymes.push({
          name: manifest.name,
          manifest,
          instance: instance as Enzyme | null,
          resolved: spore.resolved,
          scopes: spore.scopes,
          config,
        })
      }
    } catch (e) {
      const reason = (e as Error).message
      dormant.push({ name: manifest.name, reason })
      failed.set(manifest.name, reason)
      markBroken()
    }
  }

  for (const d of dormant) logger.warn(`spore '${d.name}' is dormant`, { reason: d.reason })
  if (hyphae.length === 0 && enzymes.length === 0) {
    logger.warn('germination produced zero spores: no channel and no command will ever answer')
  }

  // Startup (mycelium.ts) needs rhizas and enzymes in one interleaved, dependency-first
  // sequence — resolution.order already is that sequence; just drop hyphae, inhibitors
  // and anything that failed to germinate.
  const registered = new Set([...rhizas, ...enzymes].map((s) => s.name))
  const order = resolution.order
    .map((spore) => spore.read.manifest.name)
    .filter((name) => registered.has(name))

  return { hyphae, enzymes, rhizas, inhibitors, dormant, routes: buildRoutes(enzymes), order, brokenEnforcing, catalogs }
}
