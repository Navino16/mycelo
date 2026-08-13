import type { FormSchema } from '@mycelo/septum'

/**
 * Duck-typed throughout: the argument was built by the plugin's own copy of Zod and septum,
 * so nothing here may assume an instance of anything the core owns.
 */
export function formSchemaFor(configSchema: unknown): FormSchema {
  if (configSchema === undefined || configSchema === null) {
    return { available: false, reason: 'this plugin takes no configuration' }
  }
  try {
    // The property read is inside the try: a foreign object may expose toJsonSchema
    // as a getter, and a getter is code the core does not control either.
    const emit = (configSchema as { toJsonSchema?: unknown }).toJsonSchema
    if (typeof emit !== 'function') {
      return { available: false, reason: 'this plugin publishes no JSON Schema: configure it by hand' }
    }
    const schema: unknown = (emit as () => unknown).call(configSchema)
    // typeof admits arrays and thenables; FormSchema's `object` is neither.
    if (typeof schema !== 'object' || schema === null || Array.isArray(schema) || typeof (schema as { then?: unknown }).then === 'function') {
      return { available: false, reason: 'toJsonSchema() did not return an object' }
    }
    return { available: true, schema }
  } catch (e) {
    // instanceof Error holds under Bun's single realm; the nested try guards a subclass
    // that overrides `message` with a throwing getter.
    let reason = 'the schema cannot be converted'
    if (e instanceof Error) {
      try {
        reason = `the schema cannot be converted: ${e.message}`
      } catch {
        // keep the generic reason
      }
    }
    return { available: false, reason }
  }
}
