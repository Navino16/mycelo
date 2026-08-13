import type { FormSchema } from '@mycelo/septum'

/**
 * Duck-typed throughout: the argument was built by the plugin's own copy of Zod and septum,
 * so nothing here may assume an instance of anything the core owns.
 */
export function formSchemaFor(configSchema: unknown): FormSchema {
  if (configSchema === undefined || configSchema === null) {
    return { available: false, reason: 'this plugin takes no configuration' }
  }
  const emit = (configSchema as { toJsonSchema?: unknown }).toJsonSchema
  if (typeof emit !== 'function') {
    return { available: false, reason: 'this plugin publishes no JSON Schema: configure it by hand' }
  }
  try {
    const schema: unknown = (emit as () => unknown).call(configSchema)
    if (typeof schema !== 'object' || schema === null) {
      return { available: false, reason: 'toJsonSchema() did not return an object' }
    }
    return { available: true, schema }
  } catch (e) {
    return { available: false, reason: `the schema cannot be converted: ${(e as Error).message}` }
  }
}
