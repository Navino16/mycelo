import { septumIncompatibility } from '@mycelo/septum'
import type { ConfigSchema, SporeModule, TranslatableRef } from '@mycelo/septum'
import { discover } from '../germination/discover.js'
import { loadModule } from '../germination/load.js'
import { isFailure, readManifest } from '../germination/manifest.js'
import type { ManifestFailure, ReadManifest } from '../germination/manifest.js'
import { SHARED_DOMAIN } from '../i18n/core-catalogs.js'
import type { RefusalArgs, RefusalKey } from '../i18n/refusal-keys.js'
import { refusalRef } from '../i18n/refusal-keys.js'
import { isRef } from '../i18n/refusal.js'
import type { Db } from '../persistence/db.js'
import { describeThrown } from '../support/thrown.js'
import { undeclaredSecretsRefusal, undeclaredSecretKeys } from './plugins.js'
import { getInstall, listInstalls, readSettings, recordInstall, setEnabled } from './store.js'

export interface EnableOk { ok: true }
export interface EnableRefusal { ok: false, refusal: TranslatableRef }

/**
 * design §4: every refusal the core authors lives in `common`, which bind.ts already opens to every
 * spore without a declaration. No English twin — `common`'s own `en` is the English (design §2.2).
 */
function refuse<K extends RefusalKey>(key: K, ...params: RefusalArgs<K>): EnableRefusal {
  return { ok: false, refusal: refusalRef(key, ...params) }
}

/**
 * Records every spore present on disk that has no row yet. This phase's stand-in for
 * phase 8's inoculate. It never deletes a row whose directory has gone: an operator's
 * settings must survive an unmounted volume.
 */
export function syncInstalls(db: Db, sporesDirs: readonly string[]): { added: readonly string[] } {
  // An all-disabled first run cannot be undone from a channel: /plugin-enable lives in
  // `admin`, which would be disabled too. Hence one transaction and one write per spore:
  // a crash mid-walk must leave the table empty, so the next boot is still a first run.
  const firstRun = listInstalls(db).length === 0
  const added: string[] = []
  // Statements issued through `db` inside this callback run on the same connection, and
  // therefore inside the BEGIN the driver opened for it.
  db.transaction(() => {
    for (const location of discover(sporesDirs)) {
      const read = readManifest(location)
      if (isFailure(read)) continue
      const { manifest } = read
      if (getInstall(db, manifest.name) !== null) continue
      recordInstall(db, manifest.name, manifest.kind, firstRun)
      added.push(manifest.name)
    }
  })
  return { added }
}

/**
 * The spore of that name on disk. A manifest that failed to parse carries no validated
 * name, so it is matched on its directory instead — all a failed manifest leaves.
 */
export function findSpore(sporesDirs: readonly string[], name: string): ReadManifest | ManifestFailure | undefined {
  for (const location of discover(sporesDirs)) {
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
  sporesDirs: readonly string[],
  name: string,
): Promise<SporeModule<unknown, unknown> | null | undefined> {
  const found = findSpore(sporesDirs, name)
  if (found === undefined || isFailure(found)) return undefined
  return await loadModule(found)
}

/**
 * Spec §9.2: enabling validates the stored settings against the plugin's own schema
 * first, so a plugin missing a required field is refused here rather than going dormant
 * at the next startup, where the operator would only see it after a restart. Every
 * config-shaped dormancy cause germinate() has belongs here, not only safeParse's.
 */
export async function enablePlugin(db: Db, sporesDirs: readonly string[], name: string): Promise<EnableOk | EnableRefusal> {
  if (getInstall(db, name) === null) return refuse('refusal.plugin.notInstalled', { plugin: name })
  const found = findSpore(sporesDirs, name)
  if (found === undefined) return refuse('refusal.plugin.notOnDisk', { plugin: name })
  if (isFailure(found)) {
    return refuse('refusal.plugin.unreadableManifest', { plugin: name, detail: found.reason })
  }
  // germinate()'s verdict for this is dormancy, which for an enforcing inhibitor refuses all
  // traffic with no channel command left to undo it (design §10).
  const incompatible = septumIncompatibility(found.manifest.septum)
  if (incompatible !== undefined) {
    return refuse('refusal.plugin.septumIncompatible', { plugin: name, detail: incompatible })
  }
  let module: SporeModule<unknown, unknown> | null
  try {
    // loadModule throws on a missing entry point, a default export with no create(), and
    // anything the spore itself throws at import. All three reach an operator from here.
    module = await loadModule(found)
  } catch (e) {
    return refuse('refusal.plugin.loadFailed', { plugin: name, detail: describeThrown(e) })
  }
  if (module?.configSchema !== undefined) {
    let parsed: ReturnType<ConfigSchema<unknown>['safeParse']>
    try {
      // Duck-typed, never instanceof: the schema came from the spore's own bundled Zod.
      // Both calls throw — readSettings on a corrupt row, safeParse on any .refine()
      // predicate that does — and the declared return type says this one never rejects.
      parsed = module.configSchema.safeParse(readSettings(db, name))
    } catch (e) {
      return refuse('refusal.config.validationThrew', { detail: describeThrown(e) })
    }
    if (!parsed.success) {
      // §2.4: the issues travel as refs and task 5's renderer resolves each one, because this
      // function has no locale — it is called from a route and from the mycelium mount alike.
      return refuse('refusal.config.incomplete', { issues: configIssueRefs(parsed.error, name) })
    }
    // safeParse cannot see this one, and germination's verdict for it is dormancy — which for
    // an enforcing inhibitor refuses all traffic, with no channel command left to undo it.
    const badSecrets = undeclaredSecretKeys(module.configSchema)
    if (badSecrets.length > 0) return { ok: false, refusal: undeclaredSecretsRefusal(badSecrets) }
  }
  setEnabled(db, name, true)
  return { ok: true }
}

/**
 * One issue as a ref. A bare `messageKey` names this spore's own domain; a `common` ref is passed
 * through; anything else — including an issue with no key at all — degrades to its English
 * `message` as a literal (design §5.2, §5.3).
 */
function issueRef(record: Record<string, unknown>, domain: string): TranslatableRef {
  const key = record['messageKey']
  const params = typeof record['params'] === 'object' && record['params'] !== null
    ? record['params'] as Record<string, unknown>
    : undefined
  if (typeof key === 'string' && key.length > 0) {
    return { domain, key, ...(params === undefined ? {} : { params }) }
  }
  // isRef, not an inline shape test: a `messageKey` carrying a domain and no key would otherwise
  // reach the renderer as an object and print itself.
  if (isRef(key) && key.domain === SHARED_DOMAIN) {
    const merged = { ...key.params, ...params }
    return {
      domain: SHARED_DOMAIN,
      key: key.key,
      ...(Object.keys(merged).length === 0 ? {} : { params: merged }),
    }
  }
  // A literal renders as itself: translator.translate returns an absent key verbatim, and never
  // through ICU, so a message containing a brace cannot fail to parse.
  const message = typeof record['message'] === 'string' ? record['message'] : 'unspecified issue'
  return { domain: SHARED_DOMAIN, key: message }
}

/**
 * A plugin's issues as refs, so a caller holding a locale renders them. An issue with a path is
 * wrapped in `refusal.config.issueAt` so the field name survives translation — the nested-ref
 * mechanism of design §2.4, resolved depth-first by the same renderer.
 */
function configIssueRefs(error: unknown, domain: string): readonly TranslatableRef[] {
  const issues: unknown = (error as { issues?: unknown } | null)?.issues
  if (!Array.isArray(issues)) return []
  const refs: TranslatableRef[] = []
  for (const issue of issues as readonly unknown[]) {
    const record = typeof issue === 'object' && issue !== null ? issue as Record<string, unknown> : {}
    const path: unknown = record['path']
    const field = Array.isArray(path) ? (path as readonly PropertyKey[]).map(String).join('.') : ''
    const ref = issueRef(record, domain)
    refs.push(field.length === 0
      ? ref
      : refusalRef('refusal.config.issueAt', { field, cause: ref }))
  }
  return refs
}
