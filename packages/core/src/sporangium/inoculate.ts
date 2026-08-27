import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { InoculateOutcome, Logger } from '@mycelo/septum'
import { listInstalls, recordInstall } from '../config/store.js'
import { targetName } from '../germination/anastomoses.js'
import { septumIncompatibility } from '../germination/compat.js'
import { discover } from '../germination/discover.js'
import { CODE_ENTRIES, needsNoModule } from '../germination/load.js'
import { isFailure, readManifest } from '../germination/manifest.js'
import type { ReadManifest } from '../germination/manifest.js'
import type { Db } from '../persistence/db.js'
import { describeThrown } from '../support/thrown.js'
import { SPORE_NAME, STRAIN_SHAPE } from './driver.js'
import type { SporangiumDriver } from './driver.js'
import { extractTarball } from './extract.js'
import { githubDriver } from './github.js'
import { getSource, sourceToken } from './sources.js'

export interface InoculateContext {
  db: Db
  sporesDirs: readonly string[]
  /** The root the core owns: derived from the database's location, so data and spores move together. */
  managedRoot: string
  logger: Logger
  /** Injected in tests; production resolves it from the source row. */
  driverFor?: (sourceId: number) => SporangiumDriver
}

export interface InoculateOk extends InoculateOutcome { ok: true }
export interface InoculateRefusal { ok: false, reason: string }

export function managedRoot(dbFile: string): string {
  return join(dirname(dbFile), 'spores')
}

/**
 * Staging sits two levels down inside the managed root: `discover` skips no dot-directory,
 * it only requires a `spore.yaml`, so a one-level `.staging-xxxx/` holding one would itself
 * be discovered as a spore with no install row. Nothing an archive contains can reach an
 * immediate child of the root from here.
 */
export const STAGING_DIR = '.staging'

// chmod on a directory needs permission on its parent, not on itself, so the top-down walk
// works where readdirSync alone would not.
function restoreTraversal(dir: string): void {
  try {
    chmodSync(dir, 0o700)
  } catch {
    return
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) restoreTraversal(join(dir, entry.name))
  }
}

/** rmSync cannot remove a directory it cannot traverse, and a bundle may ship one at mode 000. */
function removeTree(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    restoreTraversal(dir)
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Removes what a crashed install left behind. Boot's, not inoculate's: the finally covers the rest. */
export function sweepStaging(managedRootPath: string): void {
  removeTree(join(managedRootPath, STAGING_DIR))
}

/** A unique directory exactly two levels below the managed root. Creates both levels. */
export function createStagingDir(managedRootPath: string): string {
  const parent = join(managedRootPath, STAGING_DIR)
  mkdirSync(parent, { recursive: true })
  return mkdtempSync(join(parent, 'x-'))
}

// A bundle's own entry points: design §4.1 forbids sources in a bundle, and treeProblem
// refuses one, so `src/index.ts` is filtered out rather than named to an author.
const BUNDLE_ENTRIES = CODE_ENTRIES.filter((entry) => !entry.startsWith('src/'))

/** A refusal reaches an API client, and readManifest's errno messages carry the staging path. */
function withoutStagingPath(reason: string, staging: string): string {
  return reason.replaceAll(`${staging}/`, '').replaceAll(staging, '')
}

/**
 * The first symlink found below `dir`, relative to it. A bundle from an unreviewed
 * sporangium is unpacked and read before it ever runs, so a link out of the tree is read
 * as this process's uid — and the yaml parser quotes the offending source line back.
 */
function firstSymlink(dir: string, prefix = ''): string | null {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (lstatSync(join(dir, entry.name)).isSymbolicLink()) return relative
    if (entry.isDirectory()) {
      const deeper = firstSymlink(join(dir, entry.name), relative)
      if (deeper !== null) return deeper
    }
  }
  return null
}

function manifestAt(root: string, directory: string): ReturnType<typeof readManifest> {
  return readManifest({
    directory,
    path: join(root, directory),
    manifestPath: join(root, directory, 'spore.yaml'),
  })
}

/** Null when the unpacked tree is installable as `name`; a sentence naming the problem otherwise. */
export function treeProblem(dir: string, name: string): string | null {
  const entries = readdirSync(dir, { withFileTypes: true }).filter((e) => e.name !== '.bundle.tgz')
  if (entries.length === 0) return 'the archive is empty'
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name)
  const files = entries.filter((e) => !e.isDirectory()).map((e) => e.name)
  if (dirs.length !== 1 || files.length > 0) {
    const unexpected = [...dirs.filter((d) => d !== name), ...files]
    return `the archive must hold exactly one directory named '${name}' and nothing else; it also holds ${unexpected.join(', ')}`
  }
  if (dirs[0] !== name) return `the archive holds '${dirs[0]}', not the requested '${name}'`
  const root = join(dir, name)
  const link = firstSymlink(root)
  if (link !== null) return `the archive carries a symlink at '${link}'; a bundle ships regular files only`
  if (existsSync(join(root, 'src'))) {
    return 'the archive carries a src/ directory: a bundle ships one index.js and no sources (design §4.1)'
  }
  if (!existsSync(join(root, 'spore.yaml'))) return 'the archive holds no spore.yaml'
  const read = manifestAt(dir, name)
  if (isFailure(read)) return `the archive's spore.yaml does not parse: ${withoutStagingPath(read.reason, dir)}`
  if (read.manifest.name !== name) {
    return `the archive's manifest declares '${read.manifest.name}', not the requested '${name}'`
  }
  const incompatible = septumIncompatibility(read.manifest.septum)
  if (incompatible !== undefined) return `the spore ${incompatible}`
  if (!needsNoModule(read.manifest) && !BUNDLE_ENTRIES.some((c) => existsSync(join(root, c)))) {
    return `the archive holds no entry point: expected one of ${BUNDLE_ENTRIES.join(', ')}`
  }
  return null
}

/**
 * Every mandatory `requires:` target the installed set does not satisfy, by name (design
 * §9.2). Narrower than germination's own resolution on purpose: an unmountable mycelium
 * scope and a requirement cycle also cause dormancy and are not reported here.
 */
function unsatisfiedRequirements(
  manifest: ReadManifest['manifest'],
  db: Db,
  sporesDirs: readonly string[],
): readonly string[] {
  // A `rhiza:` requirement is satisfied by a rhiza and nothing else (core spec §6.1), so a
  // name match alone would promise a dependency the next boot goes dormant for.
  const installed = new Map<string, string>([['mycelium', 'rhiza']])
  for (const location of discover(sporesDirs)) {
    const other = readManifest(location)
    if (!isFailure(other)) installed.set(other.manifest.name, other.manifest.kind)
  }
  // A disabled install never germinates, so it satisfies nothing.
  const disabled = new Set(listInstalls(db).filter((i) => !i.enabled).map((i) => i.name))
  const satisfied = (target: string): boolean => {
    const n = targetName(target)
    return installed.get(n) === 'rhiza' && !disabled.has(n)
  }
  const missing: string[] = []
  for (const requirement of manifest.requires ?? []) {
    if ('any_of' in requirement) {
      // Not resolved and not chosen for the operator: design §9.2 refuses to collapse an
      // any_of on their behalf, so the message names every alternative.
      if (!requirement.any_of.some((a) => satisfied(a.rhiza))) {
        missing.push(`one of ${requirement.any_of.map((a) => `'${targetName(a.rhiza)}'`).join(', ')}`)
      }
    } else if (!requirement.optional && !satisfied(requirement.rhiza)) {
      missing.push(`'${targetName(requirement.rhiza)}'`)
    }
  }
  return missing
}

/**
 * design §9: nine ordered steps, and the order is the design — every refusal happens before
 * anything is written where discover() could see it.
 */
export async function inoculate(
  ctx: InoculateContext,
  request: { sourceId: number, name: string, strain?: string },
): Promise<InoculateOk | InoculateRefusal> {
  const { db, logger, managedRoot: root } = ctx
  const roots = [...ctx.sporesDirs, root]

  // Both shapes are already guaranteed by parseTag on the way in; validated again here
  // because this is where a name becomes a directory and a strain becomes a stored row.
  if (!SPORE_NAME.test(request.name)) {
    return { ok: false, reason: `'${request.name}' is not a spore name: lowercase letters, digits and dashes only` }
  }
  if (request.strain !== undefined && !STRAIN_SHAPE.test(request.strain)) {
    return { ok: false, reason: `'${request.strain}' is not a strain: a strain is a semver such as 1.2.3` }
  }

  const source = getSource(db, request.sourceId)
  if (source === null) return { ok: false, reason: `no source with id ${String(request.sourceId)}` }
  if (!source.enabled) return { ok: false, reason: `source '${source.label}' is disabled` }
  if (source.driver === 'local') {
    return { ok: false, reason: `source '${source.label}' is a local root: its spores are already installed` }
  }
  const driver = ctx.driverFor?.(request.sourceId)
    ?? githubDriver(source.location, sourceToken(db, request.sourceId))

  let strains: readonly string[]
  try {
    strains = await driver.strains(request.name)
  } catch (e) {
    return { ok: false, reason: `cannot read source '${source.label}': ${describeThrown(e)}` }
  }
  if (strains.length === 0) {
    return { ok: false, reason: `source '${source.label}' offers no spore named '${request.name}'` }
  }
  const strain = request.strain ?? strains[0]
  if (strain === undefined || !strains.includes(strain)) {
    return { ok: false, reason: `'${request.name}' has no strain ${String(request.strain)}; it offers ${strains.join(', ')}` }
  }

  // Before downloading, so the operator learns which root holds it and no tarball has to
  // be cleaned up (design §9 step 3).
  const held = discover(roots).find((l) => l.directory === request.name)
  if (held !== undefined) return { ok: false, reason: `'${request.name}' is already installed at '${held.path}'` }

  let tarball: Uint8Array
  try {
    tarball = (await driver.fetch(request.name, strain)).tarball
  } catch (e) {
    return { ok: false, reason: `cannot fetch '${request.name}@${strain}': ${describeThrown(e)}` }
  }

  // Inside the managed root, so the move below is a rename on one filesystem rather than a
  // cross-device one, which renameSync does not fall back from.
  let staging: string
  try {
    staging = createStagingDir(root)
  } catch (e) {
    const code = (e as { code?: unknown }).code
    return { ok: false, reason: `the managed root cannot be written${typeof code === 'string' ? ` (${code})` : ''}` }
  }
  try {
    try {
      await extractTarball(tarball, staging)
    } catch (e) {
      return { ok: false, reason: `cannot unpack '${request.name}@${strain}': ${withoutStagingPath(describeThrown(e), staging)}` }
    }
    // treeProblem walks the unpacked tree, and a bundle may ship a directory it cannot read.
    let problem: string | null
    try {
      problem = treeProblem(staging, request.name)
    } catch (e) {
      problem = `the archive cannot be inspected: ${withoutStagingPath(describeThrown(e), staging)}`
    }
    if (problem !== null) {
      return { ok: false, reason: `'${request.name}@${strain}' is not installable: ${problem}` }
    }
    const read = manifestAt(staging, request.name)
    // treeProblem parsed this same file and returned null, so the guard only narrows the type.
    if (isFailure(read)) {
      return { ok: false, reason: `'${request.name}@${strain}' is not installable: ${withoutStagingPath(read.reason, staging)}` }
    }

    const warnings: string[] = []
    if (!source.official) {
      warnings.push(`'${source.label}' is not the official sporangium: its spores are not code-reviewed before publication`)
    }
    const missing = unsatisfiedRequirements(read.manifest, db, roots)
    if (missing.length > 0) {
      warnings.push(`'${request.name}' requires ${missing.join(', ')}, which nothing installed provides: it will be dormant until you install them`)
    }

    // One rename, so a spore is never half-visible to a concurrent discover() (design §9 step 8).
    // The collision check above uses discover(), which needs a spore.yaml, so a stray directory
    // in the managed root is invisible to it and only surfaces here.
    try {
      renameSync(join(staging, request.name), join(root, request.name))
    } catch (e) {
      const code = (e as { code?: unknown }).code
      const detail = typeof code === 'string' ? ` (${code})` : ''
      return { ok: false, reason: `cannot move '${request.name}' into the managed root${detail}: something already occupies its directory there` }
    }
    recordInstall(db, read.manifest.name, read.manifest.kind, false, { sourceId: request.sourceId, strain })
    logger.info(`inoculated '${request.name}@${strain}' from '${source.label}'`)
    return { ok: true, name: request.name, strain, warnings, restartRequired: true }
  } finally {
    try {
      removeTree(staging)
    } catch (e) {
      // Never turn a completed install into a rejection; the residue is two levels down,
      // invisible to discover(), and swept at the next boot.
      logger.warn(`could not remove the staging directory for '${request.name}'`, { error: describeThrown(e) })
    }
  }
}
