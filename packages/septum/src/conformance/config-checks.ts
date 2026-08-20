import type { ConfigSchema } from '../spore.js'

/** A refusal the core can actually render: a non-empty array of `{ path, message }`. */
function isWellFormedConfigError(error: unknown): boolean {
  const issues = (error as { issues?: unknown } | null)?.issues
  return Array.isArray(issues) && issues.length > 0 && issues.every((i) =>
    typeof i === 'object' && i !== null
      && Array.isArray((i as { path?: unknown }).path)
      && typeof (i as { message?: unknown }).message === 'string')
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
  if (schema.toJsonSchema !== undefined && typeof schema.toJsonSchema !== 'function') {
    failures.push('configSchema.toJsonSchema is present but is not a function')
  }
  return failures
}
