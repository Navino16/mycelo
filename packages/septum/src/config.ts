import { z } from 'zod'
import type { TranslatableRef } from './context.js'
import type { ConfigIssue, ConfigSchema } from './spore.js'

/** What `PluginsConfigure.formSchema()` resolves to for one plugin's settings form. */
export type FormSchema =
  | { available: true; schema: object }
  | {
      available: false
      /** English, for the operator's log: a translated log cannot be grepped (design §5.2). */
      reason: string
      /** A `core`-domain key the API translates before answering. */
      reasonKey?: string
      reasonParams?: Record<string, unknown>
    }

/** `defineConfig`'s second argument. */
export interface ConfigOptions {
  /**
   * Setting keys holding a credential. A key the schema does not declare makes the spore
   * dormant, and the conformance kit reports it — but only for a closed JSON Schema: a plugin
   * publishing no `toJsonSchema`, or an explicitly open schema, is exempt from the check in
   * both, and a typo'd entry then germinates without warning.
   */
  readonly secrets?: readonly string[]
}

/** §4: every refusal key the core authors lives in `common`, under a `refusal.` prefix. */
const REFUSAL_DOMAIN = 'common'

/**
 * §2.3, measured against zod 4.5.4. A whitelist, never a default branch: a zod minor adding a code
 * yields an issue with no `messageKey`, which renders `message` in English rather than a raw dotted
 * key. `custom` is absent on purpose — it is the one code meaning the plugin wrote the key itself.
 */
const MAPPED: Readonly<Record<string, { key: string, params: readonly string[] }>> = {
  invalid_type: { key: 'refusal.config.invalidType', params: ['expected'] },
  too_small: { key: 'refusal.config.tooSmall', params: ['origin', 'minimum'] },
  too_big: { key: 'refusal.config.tooBig', params: ['origin', 'maximum'] },
  invalid_format: { key: 'refusal.config.invalidFormat', params: ['format'] },
  invalid_value: { key: 'refusal.config.invalidValue', params: ['values'] },
  not_multiple_of: { key: 'refusal.config.notMultipleOf', params: ['divisor'] },
  unrecognized_keys: { key: 'refusal.config.unrecognizedKeys', params: ['keys'] },
}

function pick(issue: Record<string, unknown>, names: readonly string[]): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const name of names) {
    const value = issue[name]
    if (value === undefined) continue
    // Joined here, not in the ICU: IntlMessageFormat.format returns an ARRAY when any parameter
    // is not a primitive, and stringifying that prepends a comma — `{values}` with ['a','b']
    // renders "must be one of: ,a,b". Measured 2026-09-04.
    params[name] = Array.isArray(value) ? value.map((v) => String(v)).join(', ') : value
  }
  return params
}

/**
 * §2.3: `code === 'custom'` — a `.refine()` or a `.check()` — means `message` IS a key, in the
 * declaring spore's own domain. Every other code takes a `common` key derived from the code.
 */
export function toConfigIssue(raw: z.core.$ZodIssue): ConfigIssue {
  const issue = raw as unknown as Record<string, unknown>
  const message = typeof issue['message'] === 'string' ? issue['message'] : 'unspecified issue'
  const base: ConfigIssue = { path: raw.path, message }
  // An empty error callback result would yield an empty key — guard against it by emitting
  // no messageKey, so the catalogue is not consulted and `message` renders as-is.
  if (raw.code === 'custom') return message.length === 0 ? base : { ...base, messageKey: message }
  const mapped = MAPPED[raw.code]
  if (mapped === undefined) return base
  // §2.3: `inclusive: false` is a second key, not a nested ICU select — `.gt()` and `.gte()` are
  // different sentences in French, and a parameter bag derived from the AST stops matching a
  // two-level select.
  const key = issue['inclusive'] === false ? `${mapped.key}Exclusive` : mapped.key
  const ref: TranslatableRef = { domain: REFUSAL_DOMAIN, key }
  return { ...base, messageKey: ref, params: pick(issue, mapped.params) }
}

/**
 * Wraps a Zod schema into the ConfigSchema the core consumes, including the JSON Schema
 * the phase 9 form is generated from. Conversion is lazy: z.custom() throws, and a plugin
 * using one must still germinate — it simply gets no generated form. `options.secrets` names
 * the settings that hold a credential.
 */
export function defineConfig<T>(schema: z.ZodType<T>, options?: ConfigOptions): ConfigSchema<T> {
  return {
    safeParse: (input) => {
      const result = schema.safeParse(input)
      return result.success
        ? { success: true, data: result.data }
        : { success: false, error: { issues: result.error.issues.map(toConfigIssue) } }
    },
    // io: 'input' — under the default 'output' a field with .default() is reported as
    // required, and the generated form would demand what the schema already fills in.
    toJsonSchema: () => z.toJSONSchema(schema, { io: 'input' }),
    secrets: options?.secrets,
  }
}
