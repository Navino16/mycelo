import type { SporeModule } from '@mycelo/septum'
import { discover } from '../germination/discover.js'
import { loadModule } from '../germination/load.js'
import { isFailure, readManifest } from '../germination/manifest.js'
import type { ManifestFailure, ReadManifest } from '../germination/manifest.js'
import type { Db } from '../persistence/db.js'
import { describeThrown } from '../support/thrown.js'
import { getInstall, listInstalls, readSettings, recordInstall, setEnabled } from './store.js'

export interface EnableOk { ok: true }
export interface EnableRefusal { ok: false, reason: string }

/**
 * Records every spore present on disk that has no row yet. This phase's stand-in for
 * phase 8's inoculate. It never deletes a row whose directory has gone: an operator's
 * settings must survive an unmounted volume.
 */
export function syncInstalls(db: Db, sporesDir: string): { added: readonly string[] } {
  // An all-disabled first run cannot be undone from a channel: /plugin-enable lives in
  // `admin`, which would be disabled too.
  const firstRun = listInstalls(db).length === 0
  const added: string[] = []
  for (const location of discover(sporesDir)) {
    const read = readManifest(location)
    if (isFailure(read)) continue
    const { manifest } = read
    if (getInstall(db, manifest.name) !== null) continue
    recordInstall(db, manifest.name, manifest.kind)
    if (firstRun) setEnabled(db, manifest.name, true)
    added.push(manifest.name)
  }
  return { added }
}

/**
 * The spore of that name on disk. A manifest that failed to parse carries no validated
 * name, so it is matched on its directory instead — all a failed manifest leaves.
 */
function findSpore(sporesDir: string, name: string): ReadManifest | ManifestFailure | undefined {
  for (const location of discover(sporesDir)) {
    const read = readManifest(location)
    if (isFailure(read)) {
      if (location.directory === name) return read
      continue
    }
    if (read.manifest.name === name) return read
  }
  return undefined
}

/**
 * The loaded module of a spore present on disk. `undefined` means no such spore is
 * there; `null` means it was found but is text-only and has no module. Propagates
 * whatever loadModule() throws — enablePlugin() is where that becomes a refusal.
 */
export async function loadSporeModule(
  sporesDir: string,
  name: string,
): Promise<SporeModule<unknown, unknown> | null | undefined> {
  const found = findSpore(sporesDir, name)
  if (found === undefined || isFailure(found)) return undefined
  return await loadModule(found)
}

/**
 * Spec §9.2: enabling validates the stored settings against the plugin's own schema
 * first, so a plugin missing a required field is refused here rather than going dormant
 * at the next startup, where the operator would only see it after a restart.
 */
export async function enablePlugin(db: Db, sporesDir: string, name: string): Promise<EnableOk | EnableRefusal> {
  if (getInstall(db, name) === null) return { ok: false, reason: `plugin '${name}' is not installed` }
  const found = findSpore(sporesDir, name)
  if (found === undefined) return { ok: false, reason: `no spore named '${name}' is present on disk` }
  if (isFailure(found)) return { ok: false, reason: `spore '${name}' has an unreadable manifest: ${found.reason}` }
  let module: SporeModule<unknown, unknown> | null
  try {
    // loadModule throws on a missing entry point, a default export with no create(), and
    // anything the spore itself throws at import. All three reach an operator from here.
    module = await loadModule(found)
  } catch (e) {
    return { ok: false, reason: `spore '${name}' failed to load: ${describeThrown(e)}` }
  }
  if (module?.configSchema !== undefined) {
    // Duck-typed, never instanceof: the schema came from the spore's own bundled Zod.
    const parsed = module.configSchema.safeParse(readSettings(db, name))
    if (!parsed.success) {
      return { ok: false, reason: `configuration is incomplete: ${String(parsed.error)}` }
    }
  }
  setEnabled(db, name, true)
  return { ok: true }
}
