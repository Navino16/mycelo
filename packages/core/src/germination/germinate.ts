import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { septumIncompatibility } from '@mycelo/septum'
import type { Enzyme, Hypha, Inhibitor, Logger, Manifest, Rhiza } from '@mycelo/septum'
import { describeUndeclaredSecrets, undeclaredSecretKeys, undeclaredSecretsRefusal } from '../config/plugins.js'
import { getInstall } from '../config/store.js'
import { loadCatalogs } from '../i18n/catalog.js'
import { CORE_DOMAIN, SHARED_DOMAIN } from '../i18n/core-catalogs.js'
import type { LocaleMessages } from '../i18n/catalog.js'
import type { Db } from '../persistence/db.js'
import { describeConfigError } from '../support/thrown.js'
import { resolve, targetName } from './anastomoses.js'
import type { AnyOfChoice } from './anastomoses.js'
import { discover } from './discover.js'
import { fault } from './fault.js'
import type { Fault } from './fault.js'
import { loadModule } from './load.js'
import { isFailure, readManifest } from './manifest.js'
import type { ReadManifest } from './manifest.js'
import { buildRoutes } from './registry.js'
import { listAliases } from '../rhizomorph/aliases.js'
import type {
  Dormant, DormantRequirement, GerminatedEnzyme, GerminatedHypha, GerminatedInhibitor,
  GerminatedRhiza, Registry,
} from './registry.js'
import { capabilityShapeError, enzymeShapeError, hyphaShapeError, inhibitorShapeError, rhizaShapeError, unreferencedHandlers } from './shape.js'

/**
 * A manifest's `requires:` as bare target names — `radarr@^2` is the node called `radarr` —
 * each any_of entry carrying the alternative resolution collapsed it to. Matched on the
 * alternative list rather than by index: `evaluate` records no choice for a group that
 * resolved to the mycelium.
 */
function dormantRequirements(
  manifest: Manifest, choices: readonly AnyOfChoice[],
): readonly DormantRequirement[] {
  const pending = [...choices]
  return (manifest.requires ?? []).map((requirement) => {
    if (!('any_of' in requirement)) {
      return { targets: [targetName(requirement.rhiza)], optional: requirement.optional }
    }
    const targets = requirement.any_of.map((a) => targetName(a.rhiza))
    const at = pending.findIndex((c) => c.alternatives.length === targets.length
      && c.alternatives.every((a, i) => a === targets[i]))
    const chosen = at === -1 ? undefined : pending.splice(at, 1)[0]?.chosen
    return { targets, optional: false, ...(chosen === undefined ? {} : { chosen }) }
  })
}

/**
 * Walks the spores directory, resolves dependencies, then loads only the survivors in
 * topological order. A spore that fails goes dormant with a reason; only a command
 * collision halts the whole phase (spec §8). CycleError propagates out untouched.
 */
export async function germinate(
  sporesDirs: readonly string[],
  logger: Logger,
  pluginConfig: Readonly<Record<string, unknown>> = {},
  db?: Db,
): Promise<Registry> {
  // A missing directory and a missing config file both resolve quietly to defaults
  // (spec-compliant on their own), but their combination — run from the wrong cwd —
  // produced "germinated 0 spores" and exit 0 with no word said. Not a crash, but not
  // legible either.
  const aliases = db === undefined ? new Map<string, string>() : listAliases(db)
  const missing = sporesDirs.filter((dir) => !existsSync(dir))
  if (missing.length === sporesDirs.length) {
    logger.warn(`no spores directory exists: ${missing.map((d) => `'${d}'`).join(', ')} — nothing will germinate`)
  } else if (missing.length > 0) {
    logger.warn(`spores directory does not exist: ${missing.map((d) => `'${d}'`).join(', ')}`)
  }

  const reads: ReadManifest[] = []
  const dormant: Dormant[] = []
  // Design §7: an enforcing inhibitor that fails to germinate must still refuse all
  // traffic. Only germinate() holds both facts at once — the manifest and the dormancy.
  const brokenEnforcing: string[] = []
  for (const location of discover(sporesDirs)) {
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
  const failed = new Map<string, Fault>()
  const catalogs = new Map<string, LocaleMessages>()

  for (const spore of resolution.order) {
    const { manifest } = spore.read
    const markBroken = (): void => {
      if (manifest.kind === 'inhibitor' && manifest.enforcing) brokenEnforcing.push(manifest.name)
    }
    // Both fields from one value, so the sentence and the ref cannot drift apart while
    // `reason` still exists (deleted in task 8).
    const goDormant = (f: Fault): void => {
      dormant.push({ name: manifest.name, reason: f.message, refusal: f.refusal })
      failed.set(manifest.name, f)
      markBroken()
    }
    // design §10: refused here as well as at inoculate, because a spore installed by an
    // older core, or dropped into a local root by hand, never went through inoculate.
    const incompatible = septumIncompatibility(manifest.septum)
    if (incompatible !== undefined) {
      goDormant(fault(`spore '${manifest.name}' ${incompatible}`,
        'refusal.plugin.septumIncompatible', { plugin: manifest.name, detail: incompatible }))
      continue
    }
    // design §3: the runtime owns these two domains, and a spore taking either would
    // replace the bot's own refusal sentences.
    if (manifest.name === CORE_DOMAIN || manifest.name === SHARED_DOMAIN) {
      goDormant(fault(`'${manifest.name}' is a reserved translation domain`,
        'refusal.germination.reservedDomain', { plugin: manifest.name }))
      continue
    }
    const cause = [...spore.mandatory].find((name) => failed.has(name))
    if (cause !== undefined) {
      const causeFault = failed.get(cause)
      const anyOf = spore.anyOf.find((choice) => choice.chosen === cause)
      // No re-collapse (design §2.2); if the cause was an any_of choice, the message
      // names the untried alternatives alongside it.
      const listed = anyOf?.alternatives.map((n) => `'${n}'`).join(', ')
      goDormant(anyOf !== undefined && causeFault !== undefined
        ? fault(`requires one of rhiza ${String(listed)}; '${cause}' was chosen and is dormant: ${causeFault.message}`,
          'refusal.germination.anyOfDependencyDormant',
          { alternatives: listed, chosen: cause, cause: causeFault.refusal })
        : fault(`requires rhiza '${cause}', which is dormant: ${causeFault?.message ?? ''}`,
          'refusal.germination.dependencyDormant',
          { rhiza: cause, ...(causeFault === undefined ? {} : { cause: causeFault.refusal }) }))
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
      const detail = (e as Error).message
      goDormant(fault(detail, 'refusal.germination.catalogFailed', { detail }))
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
            const detail = describeConfigError(parsed.error)
            goDormant(fault(`configuration rejected: ${detail}`,
              'refusal.config.incomplete', { plugin: manifest.name, detail }))
            continue
          }
          const badSecrets = undeclaredSecretKeys(module.configSchema)
          if (badSecrets.length > 0) {
            goDormant({
              message: describeUndeclaredSecrets(badSecrets),
              refusal: undeclaredSecretsRefusal(badSecrets),
            })
            continue
          }
          config = parsed.data
        }
        instance = module.create()
        if (manifest.kind === 'hypha') {
          const problem = hyphaShapeError(instance, manifest.kind)
            ?? capabilityShapeError(instance as Record<string, unknown>, manifest)
          if (problem !== null) { goDormant(problem); continue }
        } else if (manifest.kind === 'rhiza') {
          const problem = rhizaShapeError(instance)
          if (problem !== null) { goDormant(problem); continue }
        } else if (manifest.kind === 'inhibitor') {
          const problem = inhibitorShapeError(instance)
          if (problem !== null) { goDormant(problem); continue }
        } else {
          const problem = enzymeShapeError(instance, manifest.commands)
          if (problem !== null) { goDormant(problem); continue }
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
      const detail = (e as Error).message
      goDormant(fault(detail, 'refusal.germination.moduleCreateThrew', { detail }))
    }
  }

  for (const d of dormant) logger.warn(`spore '${d.name}' is dormant`, { reason: d.reason })
  if (hyphae.length === 0 && enzymes.length === 0) {
    logger.warn('germination produced zero spores: no channel and no command will ever answer')
  }

  // Startup (boot/start.ts) needs rhizas and enzymes in one interleaved, dependency-first
  // sequence — resolution.order already is that sequence; just drop hyphae, inhibitors
  // and anything that failed to germinate.
  const registered = new Set([...rhizas, ...enzymes].map((s) => s.name))
  const order = resolution.order
    .map((spore) => spore.read.manifest.name)
    .filter((name) => registered.has(name))

  // One place rather than fourteen `dormant.push` sites: `reads` holds every manifest that
  // parsed, including those that went dormant later in this walk.
  const declared = new Map(reads.map((read) => [
    read.manifest.name,
    dormantRequirements(read.manifest, resolution.anyOfChoices.get(read.manifest.name) ?? []),
  ]))
  const recorded = dormant.map((entry) => {
    const requires = declared.get(entry.name)
    return requires === undefined ? entry : { ...entry, requires }
  })

  return {
    hyphae, enzymes, rhizas, inhibitors, dormant: recorded,
    routes: buildRoutes(enzymes, aliases), order, brokenEnforcing, catalogs,
  }
}
