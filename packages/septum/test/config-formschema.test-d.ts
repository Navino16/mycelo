import type { FormSchema } from '../src/config.js'

// Checked by `tsc -p tsconfig.spec.json`, never by bun test: `import type` is erased, so a
// runtime assertion cannot make this claim.

// A refusal may carry a catalogue key and its parameters.
export const refusal: FormSchema = {
  available: false,
  reason: 'this plugin takes no configuration',
  reasonKey: 'config.schema.none',
  reasonParams: { name: 'ping' },
}

// @ts-expect-error reasonKey belongs to the refusal variant only
export const wrong: FormSchema = { available: true, schema: {}, reasonKey: 'x' }
