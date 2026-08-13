import { z } from 'zod'
import type { ConfigSchema } from './spore.js'

/** What `PluginsConfigure.formSchema()` (task 7) resolves to for one plugin's settings form. */
export type FormSchema =
  | { available: true; schema: object }
  | { available: false; reason: string }

/**
 * Wraps a Zod schema into the ConfigSchema the core consumes, including the JSON Schema
 * the phase 9 form is generated from. Conversion is lazy: z.custom() throws, and a plugin
 * using one must still germinate — it simply gets no generated form.
 */
export function defineConfig<T>(schema: z.ZodType<T>): ConfigSchema<T> {
  return {
    safeParse: (input) => {
      const result = schema.safeParse(input)
      return result.success
        ? { success: true, data: result.data }
        : { success: false, error: result.error }
    },
    // io: 'input' — under the default 'output' a field with .default() is reported as
    // required, and the generated form would demand what the schema already fills in.
    toJsonSchema: () => z.toJSONSchema(schema, { io: 'input' }),
  }
}
