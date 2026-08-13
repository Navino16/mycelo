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
  // Gated on its own input: safeParse(undefined) fails against any z.object(), so an
  // ungated check would punish an author who declares only one of the two configs.
  if (validConfig !== undefined && !schema.safeParse(validConfig).success) {
    failures.push('configSchema rejects the declared valid config')
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
