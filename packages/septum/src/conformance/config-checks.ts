import type { ConfigSchema } from '../spore.js'

/** A refusal the core can actually render: a non-empty array of `{ path, message }`. */
function isWellFormedConfigError(error: unknown): boolean {
  const issues = (error as { issues?: unknown } | null)?.issues
  return Array.isArray(issues) && issues.length > 0 && issues.every((i) =>
    typeof i === 'object' && i !== null
      && Array.isArray((i as { path?: unknown }).path)
      && typeof (i as { message?: unknown }).message === 'string')
}

/** A member of an object the plugin built. A getter is code, so the read itself is guarded. */
function member(target: unknown, name: string): unknown {
  if (typeof target !== 'object' || target === null) return undefined
  try {
    return (target as Record<string, unknown>)[name]
  } catch {
    return undefined
  }
}

/**
 * `secrets` as the core reads it — `Array.isArray` and a string filter, never the typed property.
 * A JavaScript plugin can write `secrets: 'token'`, which the core ignores while storing that
 * credential in the clear, so the kit has to name the mistake rather than throw on it.
 */
function declaredSecrets(schema: ConfigSchema<unknown>): { keys: readonly string[], malformed?: string } {
  const secrets = member(schema, 'secrets')
  if (secrets === undefined) return { keys: [] }
  if (!Array.isArray(secrets)) {
    return { keys: [], malformed: 'configSchema.secrets is present but is not an array of strings' }
  }
  const keys = secrets.filter((k): k is string => typeof k === 'string')
  if (keys.length === secrets.length) return { keys }
  return { keys, malformed: 'configSchema.secrets holds an entry that is not a string, which the core ignores' }
}

/**
 * Secret keys the plugin's own JSON Schema does not declare. Mirrors the core's `formSchemaFor`
 * and `undeclaredKeys` clause by clause — a kit stricter than the runtime is as broken as one
 * more lenient, and every shape the core answers `[]` for must answer `[]` here.
 */
function undeclaredSecrets(schema: ConfigSchema<unknown>, keys: readonly string[]): readonly string[] {
  if (keys.length === 0) return []
  let emitted: unknown
  try {
    const emit = member(schema, 'toJsonSchema')
    if (typeof emit !== 'function') return []
    emitted = (emit as () => unknown).call(schema)
  } catch {
    // z.custom() makes the conversion throw, and such a plugin must still germinate.
    return []
  }
  // typeof admits arrays and thenables; the core reads neither as a schema.
  if (typeof emitted !== 'object' || emitted === null || Array.isArray(emitted)
    || typeof (emitted as { then?: unknown }).then === 'function') return []
  const asObject = emitted as { properties?: unknown, additionalProperties?: unknown }
  const open = asObject.additionalProperties !== undefined && asObject.additionalProperties !== false
  const properties: unknown = asObject.properties
  if (open || typeof properties !== 'object' || properties === null) return []
  return keys.filter((key) => !Object.hasOwn(properties, key))
}

/**
 * The `configSchema` checks every kind's conformance kit runs identically, regardless of
 * whether the plugin is a hypha, rhiza, enzyme or inhibitor.
 */
export function configSchemaFailures(
  schema: ConfigSchema<unknown> | undefined,
  validConfig: unknown,
  invalidConfig: unknown,
): string[] {
  if (schema === undefined) return []
  const failures: string[] = []
  // Checked before anything invokes it, and before every other check: safeParse is
  // mandatory, and a non-callable one makes the spore dormant and enable() refuse.
  if (typeof schema.safeParse !== 'function') return ['configSchema.safeParse is not a function']
  // Gated on its own input: safeParse(undefined) fails against any z.object(), so an
  // ungated check would punish an author who declares only one of the two configs.
  if (validConfig !== undefined) {
    const parsed = schema.safeParse(validConfig)
    if (!parsed.success) {
      failures.push('configSchema rejects the declared valid config')
    } else if (parsed.data === undefined) {
      // ctx.config would be undefined at germination, and every read off it would throw.
      failures.push('configSchema accepts the declared valid config but returns no data')
    }
  }
  if (invalidConfig !== undefined) {
    const parsed = schema.safeParse(invalidConfig)
    if (parsed.success) {
      failures.push('configSchema accepts the declared invalid config')
    } else if (!isWellFormedConfigError(parsed.error)) {
      // Otherwise the core's own describeConfigError degrades to a useless reason, and the
      // route filtering a partial write by path[0] finds nothing to filter (design §5.2).
      failures.push('configSchema rejects with no readable issues: error must be { issues: [{ path, message }] }')
    }
  }
  // Presence is not callability: a JavaScript plugin can export a non-callable toJsonSchema.
  const emit = member(schema, 'toJsonSchema')
  if (emit !== undefined && typeof emit !== 'function') {
    failures.push('configSchema.toJsonSchema is present but is not a function')
  }
  const secrets = declaredSecrets(schema)
  if (secrets.malformed !== undefined) failures.push(secrets.malformed)
  for (const key of undeclaredSecrets(schema, secrets.keys)) {
    failures.push(`configSchema.secrets names '${key}', which the schema does not declare`)
  }
  return failures
}
