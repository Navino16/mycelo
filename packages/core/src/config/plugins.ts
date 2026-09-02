import { and, eq } from 'drizzle-orm'
import type { FormSchema, PluginInfo, SporeKind } from '@mycelo/septum'
import type { Registry } from '../germination/registry.js'
import type { Db } from '../persistence/db.js'
import { pluginSetting } from '../persistence/schema.js'
import { listSources } from '../sporangium/sources.js'
import { REDACTED } from '../support/redaction.js'
import { describeThrown } from '../support/thrown.js'
import { formSchemaFor } from './jsonschema.js'
import { enablePlugin, findSpore, loadSporeModule } from './lifecycle.js'
import { listAliases } from '../rhizomorph/aliases.js'
import { getInstall, listInstalls, writeSetting } from './store.js'

export interface Provenance {
  /** The source's label, never its id: a read path is what an operator reads. */
  source?: string
  strain?: string
}

/**
 * Provenance per install name, for the read paths. Built as one pair of queries: a per-entry
 * lookup would be one query per plugin, and every caller reports a whole list.
 */
export function provenanceByName(db: Db): ReadonlyMap<string, Provenance> {
  const labels = new Map(listSources(db).map((s) => [s.id, s.label]))
  const out = new Map<string, Provenance>()
  for (const install of listInstalls(db)) {
    if (install.sourceId === null || install.strain === null) continue
    const label = labels.get(install.sourceId)
    if (label !== undefined) out.set(install.name, { source: label, strain: install.strain })
  }
  return out
}

// germinate.ts skips a disabled install before it can ever become a registry entry —
// germinated or dormant — so this is the only place that can still name it, and the only
// place that can name an install whose spore has gone from disk.
export function listPlugins(registry: Registry, sporesDirs: readonly string[], db?: Db): readonly PluginInfo[] {
  const installs = db === undefined ? [] : listInstalls(db)
  const provenance = db === undefined ? new Map<string, Provenance>() : provenanceByName(db)
  const aliases = db === undefined ? new Map<string, string>() : listAliases(db)
  const from = (name: string): Provenance => provenance.get(name) ?? {}
  const germinated: PluginInfo[] = [
    ...registry.hyphae.map((h) => ({ name: h.name, kind: h.manifest.kind, commands: [], state: 'germinated' as const, enabled: true, ...from(h.name) })),
    ...registry.enzymes.map((e) => ({
      name: e.name,
      kind: e.manifest.kind,
      // The names a caller types (spec §3.5). Read live, while /api/commands routes from the map
      // germination built — so between an alias write and the restart it answers, the two disagree.
      commands: e.manifest.commands.map((c) => aliases.get(`${e.name}.${c.name}`) ?? c.name),
      state: 'germinated' as const,
      enabled: true,
      ...from(e.name),
    })),
    ...registry.rhizas.map((r) => ({ name: r.name, kind: r.manifest.kind, commands: [], state: 'germinated' as const, enabled: true, ...from(r.name) })),
    ...registry.inhibitors.map((i) => ({ name: i.name, kind: i.manifest.kind, commands: [], state: 'germinated' as const, enabled: true, ...from(i.name) })),
  ]
  // A dormant spore has no manifest in the registry, but its install row recorded the kind
  // the day the manifest first parsed; only a spore that never parsed has none (plan defect 29).
  // `enabled` is what germination saw — an operator's later toggle waits for the next one.
  const recordedKind = new Map(installs.map((i) => [i.name, i.kind as SporeKind]))
  const dormant: PluginInfo[] = registry.dormant.map((d) => ({
    name: d.name,
    ...(recordedKind.has(d.name) ? { kind: recordedKind.get(d.name) } : {}),
    commands: [],
    state: 'dormant' as const,
    reason: d.reason,
    enabled: true,
    ...from(d.name),
  }))
  const known = new Set([...germinated, ...dormant].map((p) => p.name))
  // install.kind came from manifest.kind at record time (lifecycle.ts), so widening it
  // back is not a real cast across the plugin boundary.
  const rest: PluginInfo[] = installs
    .filter((install) => !known.has(install.name))
    .flatMap((install): PluginInfo[] => {
      const base = { name: install.name, kind: install.kind as SporeKind, commands: [], ...from(install.name) }
      if (!install.enabled) return [{ ...base, state: 'disabled' as const, enabled: false }]
      // Enabled, on disk, in neither the germinated nor the dormant set: it is waiting for
      // the next germination. Returning [] here dropped it from every list (spec §5).
      if (findSpore(sporesDirs, install.name) !== undefined) {
        return [{ ...base, state: 'pending' as const, enabled: true }]
      }
      // syncInstalls keeps the row of a spore whose directory has gone, so the operator
      // can recover it — which requires being able to see that it is still there.
      return [{
        ...base,
        state: 'dormant' as const,
        reason: `no spore named '${install.name}' is present on disk`,
        enabled: true,
      }]
    })
  return [...germinated, ...dormant, ...rest]
}

// The published contract says enable() rejects; enablePlugin() returns a refusal object,
// so the reason has to be re-thrown or a caller would read `undefined` as success.
export async function enableOrThrow(db: Db, sporesDirs: readonly string[], name: string): Promise<void> {
  const result = await enablePlugin(db, sporesDirs, name)
  if (!result.ok) throw new Error(result.reason)
}

// loadSporeModule() propagates whatever the spore throws at import; formSchema() resolves
// a FormSchema, so every fault becomes its available: false branch rather than a rejection.
export async function formSchemaOf(db: Db, sporesDirs: readonly string[], name: string): Promise<FormSchema> {
  if (getInstall(db, name) === null) {
    return { available: false, reason: `plugin '${name}' is not installed` }
  }
  let module: Awaited<ReturnType<typeof loadSporeModule>>
  try {
    module = await loadSporeModule(sporesDirs, name)
  } catch (e) {
    return { available: false, reason: `spore '${name}' failed to load: ${describeThrown(e)}` }
  }
  if (module === undefined) {
    return { available: false, reason: `no spore named '${name}' is present on disk` }
  }
  return formSchemaFor(module?.configSchema)
}

/** Read across the plugin boundary: `configSchema` is an object the plugin built. */
function declaredSecrets(configSchema: unknown): readonly string[] {
  const declared = member(configSchema, 'secrets')
  if (!Array.isArray(declared)) return []
  return declared.filter((k): k is string => typeof k === 'string')
}

/**
 * Secret keys a plugin declares that its own JSON Schema does not have — same exemptions as
 * `undeclaredKeys`: no schema, or an explicitly open one, is unguarded. Septum's conformance
 * kit applies the same rule, pinned against this one by a test.
 */
export function undeclaredSecretKeys(configSchema: unknown): readonly string[] {
  const keys = declaredSecrets(configSchema)
  if (keys.length === 0) return []
  return undeclaredKeys(formSchemaFor(configSchema), keys)
}

// One wording for germination's dormancy reason and enablePlugin's refusal: two spellings of
// one verdict would drift, and the operator meets whichever surface they reached first.
export function describeUndeclaredSecrets(keys: readonly string[]): string {
  const named = keys.map((k) => `'${k}'`).join(', ')
  const noun = keys.length === 1 ? 'a secret' : 'secrets'
  return `configuration declares ${noun} ${named} the schema does not have`
}

/**
 * A plugin's declared secret keys. Read through `member`, never off a typed property:
 * `configSchema` is an object the plugin built, and a getter is code.
 */
export async function secretKeysOf(
  db: Db, sporesDirs: readonly string[], name: string,
): Promise<readonly string[]> {
  if (getInstall(db, name) === null) return []
  let module: Awaited<ReturnType<typeof loadSporeModule>>
  try {
    module = await loadSporeModule(sporesDirs, name)
  } catch {
    return []
  }
  return declaredSecrets(module?.configSchema)
}

// The reason plugins.configure is safe to grant: a scope that lists configuration must
// not become a way to read every credential in the substrate.
export function redactSecrets(db: Db, name: string): Record<string, unknown> {
  // Its three siblings on this interface reject for an unknown plugin; resolving {} here
  // read exactly like a real plugin holding no settings.
  if (getInstall(db, name) === null) throw new Error(`plugin '${name}' is not installed`)
  const rows = db.select().from(pluginSetting).where(eq(pluginSetting.pluginName, name)).all()
  const out: Record<string, unknown> = {}
  for (const row of rows) {
    const parsed: unknown = row.isSecret ? REDACTED : JSON.parse(row.value)
    out[row.key] = parsed
  }
  return out
}

/**
 * Keys the plugin's own JSON Schema does not declare. An undeclared key would otherwise be
 * dropped in silence by a loose schema, or block enable() by a strict one. A plugin
 * publishing no schema, or an explicitly open one, is unguarded.
 */
export function undeclaredKeys(form: FormSchema, keys: readonly string[]): readonly string[] {
  if (!form.available) return []
  const schema = form.schema as { properties?: unknown, additionalProperties?: unknown }
  const properties: unknown = schema.properties
  // z.object emits no additionalProperties, z.looseObject emits `{}` and z.strictObject
  // `false`. Only an explicitly open schema is exempt: refusing every key a deliberately
  // open plugin accepts would shut it out of the one configuration surface there is.
  const open = schema.additionalProperties !== undefined && schema.additionalProperties !== false
  if (open || typeof properties !== 'object' || properties === null) return []
  // hasOwn, never `in`: the schema is a plugin-supplied plain object, and 'constructor'
  // is a key an operator can type.
  return keys.filter((key) => !Object.hasOwn(properties, key))
}

/** Refuses a key the plugin's own JSON Schema does not declare (`undeclaredKeys`). */
export async function writeDeclaredSetting(
  db: Db, sporesDirs: readonly string[], name: string, key: string, value: unknown,
): Promise<void> {
  const form = await formSchemaOf(db, sporesDirs, name)
  if (undeclaredKeys(form, [key]).length > 0) {
    throw new Error(`plugin '${name}' declares no setting '${key}'`)
  }
  rewriteSetting(db, name, key, value, await secretKeysOf(db, sporesDirs, name))
}

export interface SettingRejection {
  key: string
  /** The plugin's own issues, whatever shape they carried. */
  issues: unknown
}

/** A member read from an object the plugin built: never an instance check, and a getter is code. */
function member(target: unknown, name: string): unknown {
  if (typeof target !== 'object' || target === null) return undefined
  try {
    return (target as Record<string, unknown>)[name]
  } catch {
    return undefined
  }
}

function parseWith(schema: unknown, value: unknown): { ok: boolean, error: unknown } | undefined {
  const parse = member(schema, 'safeParse')
  if (typeof parse !== 'function') return undefined
  try {
    const result: unknown = (parse as (input: unknown) => unknown).call(schema, value)
    if (typeof result !== 'object' || result === null) return undefined
    return { ok: member(result, 'success') === true, error: member(result, 'error') }
  } catch {
    return undefined
  }
}

// An absent or non-array path reads as a whole-object refusal, exactly as
// support/thrown.ts renders it: two duck-typed readers of one plugin value must not
// disagree, or the same refusal blocks enable() and passes PUT with a 200.
function issuePath(issue: unknown): unknown[] {
  const path = member(issue, 'path')
  return Array.isArray(path) ? path : []
}

/**
 * `defineConfig` publishes `safeParse` alone, so a plugin written the documented way exposes
 * no per-field schema: validate the object and keep only the issues the provided keys own.
 * An empty or absent path is a refusal about the object as a whole (a top-level `.refine()`),
 * so it is attributed to every key the request carried — the object it refuses is exactly that set.
 */
function objectRejections(
  configSchema: unknown, values: Record<string, unknown>,
): readonly SettingRejection[] {
  const result = parseWith(configSchema, values)
  if (result === undefined || result.ok) return []
  const issues = member(result.error, 'issues')
  if (!Array.isArray(issues)) return []
  const wholeObject = (issues as unknown[]).filter((issue) => issuePath(issue).length === 0)
  const rejections: SettingRejection[] = []
  for (const key of Object.keys(values)) {
    const own = (issues as unknown[]).filter((issue) => issuePath(issue)[0] === key)
    if (own.length + wholeObject.length > 0) rejections.push({ key, issues: [...own, ...wholeObject] })
  }
  return rejections
}

/**
 * Spec §8: never the merged object — a two-required-field form must be fillable one field
 * at a time, which is why completeness is `enablePlugin`'s check and not this one's.
 */
export async function rejectedSettings(
  db: Db, sporesDirs: readonly string[], name: string, values: Record<string, unknown>,
): Promise<readonly SettingRejection[]> {
  if (getInstall(db, name) === null) return []
  let module: Awaited<ReturnType<typeof loadSporeModule>>
  try {
    module = await loadSporeModule(sporesDirs, name)
  } catch {
    return []
  }
  return objectRejections(module?.configSchema, values)
}

// Promote, never demote. writeSetting() rewrites is_secret too, so carrying the row's flag
// forward is what keeps an updated credential redacted; OR-ing the declaration in is what lets
// a plugin that only declares an existing key in a later version ever take effect.
export function rewriteSetting(
  db: Db, name: string, key: string, value: unknown, secrets: readonly string[] = [],
): void {
  const existing = db
    .select({ isSecret: pluginSetting.isSecret })
    .from(pluginSetting)
    .where(and(eq(pluginSetting.pluginName, name), eq(pluginSetting.key, key)))
    .get()
  const isSecret = (existing?.isSecret ?? false) || secrets.includes(key)
  // A form is handed '••••' by redactSecrets and sends the whole object back. Writing it would
  // replace the credential with its own mask, with is_secret still true and no way to tell.
  if (isSecret && value === REDACTED) return
  writeSetting(db, name, key, value, isSecret)
}
