import { and, eq } from 'drizzle-orm'
import type { FormSchema, PluginInfo, SporeKind } from '@mycelo/septum'
import type { Registry } from '../germination/registry.js'
import type { Db } from '../persistence/db.js'
import { pluginSetting } from '../persistence/schema.js'
import { describeThrown } from '../support/thrown.js'
import { formSchemaFor } from './jsonschema.js'
import { enablePlugin, findSpore, loadSporeModule } from './lifecycle.js'
import { getInstall, listInstalls, writeSetting } from './store.js'

// germinate.ts skips a disabled install before it can ever become a registry entry —
// germinated or dormant — so this is the only place that can still name it, and the only
// place that can name an install whose spore has gone from disk.
export function listPlugins(registry: Registry, sporesDir: string, db?: Db): readonly PluginInfo[] {
  const germinated: PluginInfo[] = [
    ...registry.hyphae.map((h) => ({ name: h.name, kind: h.manifest.kind, commands: [], state: 'germinated' as const, enabled: true })),
    ...registry.enzymes.map((e) => ({
      name: e.name,
      kind: e.manifest.kind,
      commands: e.manifest.commands.map((c) => c.name),
      state: 'germinated' as const,
      enabled: true,
    })),
    ...registry.rhizas.map((r) => ({ name: r.name, kind: r.manifest.kind, commands: [], state: 'germinated' as const, enabled: true })),
    ...registry.inhibitors.map((i) => ({ name: i.name, kind: i.manifest.kind, commands: [], state: 'germinated' as const, enabled: true })),
  ]
  // Dormant carries no kind: a spore may fail before its manifest ever parses. `enabled`
  // is what germination saw, like every other entry here — an operator's later toggle is
  // only reflected by the next germination.
  const dormant: PluginInfo[] = registry.dormant.map((d) => ({
    name: d.name,
    commands: [],
    state: 'dormant' as const,
    reason: d.reason,
    enabled: true,
  }))
  const known = new Set([...germinated, ...dormant].map((p) => p.name))
  // install.kind came from manifest.kind at record time (lifecycle.ts), so widening it
  // back is not a real cast across the plugin boundary.
  const rest: PluginInfo[] = db === undefined ? [] : listInstalls(db)
    .filter((install) => !known.has(install.name))
    .flatMap((install): PluginInfo[] => {
      const base = { name: install.name, kind: install.kind as SporeKind, commands: [] }
      if (!install.enabled) return [{ ...base, state: 'disabled' as const, enabled: false }]
      // syncInstalls keeps the row of a spore whose directory has gone, so the operator
      // can recover it — which requires being able to see that it is still there.
      if (findSpore(sporesDir, install.name) !== undefined) return []
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
export async function enableOrThrow(db: Db, sporesDir: string, name: string): Promise<void> {
  const result = await enablePlugin(db, sporesDir, name)
  if (!result.ok) throw new Error(result.reason)
}

// loadSporeModule() propagates whatever the spore throws at import; formSchema() resolves
// a FormSchema, so every fault becomes its available: false branch rather than a rejection.
export async function formSchemaOf(db: Db, sporesDir: string, name: string): Promise<FormSchema> {
  if (getInstall(db, name) === null) {
    return { available: false, reason: `plugin '${name}' is not installed` }
  }
  let module: Awaited<ReturnType<typeof loadSporeModule>>
  try {
    module = await loadSporeModule(sporesDir, name)
  } catch (e) {
    return { available: false, reason: `spore '${name}' failed to load: ${describeThrown(e)}` }
  }
  if (module === undefined) {
    return { available: false, reason: `no spore named '${name}' is present on disk` }
  }
  return formSchemaFor(module?.configSchema)
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
    const parsed: unknown = row.isSecret ? '••••' : JSON.parse(row.value)
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
  db: Db, sporesDir: string, name: string, key: string, value: unknown,
): Promise<void> {
  const form = await formSchemaOf(db, sporesDir, name)
  if (undeclaredKeys(form, [key]).length > 0) {
    throw new Error(`plugin '${name}' declares no setting '${key}'`)
  }
  rewriteSetting(db, name, key, value)
}

export interface SettingRejection {
  key: string
  /** The plugin's own issues where it published any, otherwise its message. */
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

/** hasOwn, never `in`: a shape is a plugin-supplied plain object and 'constructor' is a key. */
function field(shape: unknown, key: string): unknown {
  if (typeof shape !== 'object' || shape === null) return undefined
  return Object.hasOwn(shape, key) ? member(shape, key) : undefined
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

/** ZodError.issues is non-enumerable, so serialising the error itself would drop it. */
function detailOf(error: unknown): unknown {
  const issues = member(error, 'issues')
  if (Array.isArray(issues)) return issues
  return typeof error === 'string' ? error : describeThrown(error)
}

/** Undefined when the schema exposes no readable shape, which is the caller's cue to fall back. */
function fieldRejections(
  configSchema: unknown, values: Record<string, unknown>,
): readonly SettingRejection[] | undefined {
  const shape = member(configSchema, 'shape')
  if (typeof shape !== 'object' || shape === null) return undefined
  const rejections: SettingRejection[] = []
  for (const [key, value] of Object.entries(values)) {
    // A key the shape does not carry is skipped, not refused: undeclaredKeys already owns that.
    const result = parseWith(field(shape, key), value)
    if (result !== undefined && !result.ok) rejections.push({ key, issues: detailOf(result.error) })
  }
  return rejections
}

/**
 * `defineConfig` publishes `safeParse` alone, so a plugin written the documented way exposes
 * no per-field schema: validate the object and keep only the issues the provided keys own.
 */
function objectRejections(
  configSchema: unknown, values: Record<string, unknown>,
): readonly SettingRejection[] {
  const result = parseWith(configSchema, values)
  if (result === undefined || result.ok) return []
  const issues = member(result.error, 'issues')
  if (!Array.isArray(issues)) return []
  const rejections: SettingRejection[] = []
  for (const key of Object.keys(values)) {
    const own = (issues as unknown[]).filter((issue) => {
      const path = member(issue, 'path')
      return Array.isArray(path) && path[0] === key
    })
    if (own.length > 0) rejections.push({ key, issues: own })
  }
  return rejections
}

/**
 * Spec §8: each provided value against its own field schema, never the merged object — a
 * two-required-field form must be fillable one field at a time, which is why completeness
 * is `enablePlugin`'s check and not this one's.
 */
export async function rejectedSettings(
  db: Db, sporesDir: string, name: string, values: Record<string, unknown>,
): Promise<readonly SettingRejection[]> {
  if (getInstall(db, name) === null) return []
  let module: Awaited<ReturnType<typeof loadSporeModule>>
  try {
    module = await loadSporeModule(sporesDir, name)
  } catch {
    return []
  }
  const configSchema: unknown = module?.configSchema
  return fieldRejections(configSchema, values) ?? objectRejections(configSchema, values)
}

// Carries the row's is_secret forward: writeSetting() rewrites that column too, so a
// secret updated through this scope would come back unredacted from settings().
// A key with no row yet is not secret — nothing in this phase can declare one.
export function rewriteSetting(db: Db, name: string, key: string, value: unknown): void {
  const existing = db
    .select({ isSecret: pluginSetting.isSecret })
    .from(pluginSetting)
    .where(and(eq(pluginSetting.pluginName, name), eq(pluginSetting.key, key)))
    .get()
  writeSetting(db, name, key, value, existing?.isSecret ?? false)
}
