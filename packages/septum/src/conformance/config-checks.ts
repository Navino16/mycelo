import type { ConfigSchema } from '../spore.js'

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
  if (invalidConfig !== undefined && schema.safeParse(invalidConfig).success) {
    failures.push('configSchema accepts the declared invalid config')
  }
  // Presence is not callability: a JavaScript plugin can export a non-callable toJsonSchema.
  if (schema.toJsonSchema !== undefined && typeof schema.toJsonSchema !== 'function') {
    failures.push('configSchema.toJsonSchema is present but is not a function')
  }
  return failures
}
