import { z } from 'zod'
import type { ConfigError, ConfigIssue, ConfigSchema } from '../src/spore.js'
import type { TranslatableRef } from '../src/context.js'

// Checked by `tsc -p tsconfig.spec.json`, never by bun test: `import type` is erased, so a
// runtime assertion cannot make this claim.

const result = z.object({ url: z.string() }).safeParse({})
if (!result.success) {
  // Positive: a real ZodError satisfies the published contract.
  const asContract: ConfigError = result.error
  void asContract

  // Negative control: `PropertyKey` is load-bearing, not an arbitrary choice — a ZodError's
  // path can hold a number or a symbol, so a narrower `string[]` alternative must be rejected.
  interface WrongConfigError {
    readonly issues: readonly { readonly path: readonly string[]; readonly message: string }[]
  }
  // @ts-expect-error path is PropertyKey[], not assignable to string[]
  const wrong: WrongConfigError = result.error
  void wrong
}

// A readonly tuple of literals is assignable: the field is `readonly string[]`, not `string[]`.
export const withSecrets: ConfigSchema<{ apiKey: string }> = {
  safeParse: (input) => ({ success: true, data: input as { apiKey: string } }),
  secrets: ['apiKey'] as const,
}

export const wrongShape: ConfigSchema<{ apiKey: string }> = {
  safeParse: (input) => ({ success: true, data: input as { apiKey: string } }),
  // @ts-expect-error — secrets is a list of key names, not a boolean flag per field.
  secrets: { apiKey: true },
}

// A bare string is a key in the producing spore's own domain.
export const ownDomain: ConfigIssue = { path: ['port'], message: 'Too small', messageKey: 'config.port.range' }

// A ref names a domain explicitly. `common` is the only one the core will honour (§5.3), but the
// type does not encode that: the guard is a runtime one, because a plugin's value is data.
const ref: TranslatableRef = { domain: 'common', key: 'refusal.config.tooSmall', params: { minimum: 1 } }
export const refDomain: ConfigIssue = { path: [], message: 'Too small', messageKey: ref, params: { minimum: 1 } }

// `message` stays required: it is the log's only carrier, and the fallback for no key at all.
// @ts-expect-error message is required
export const noMessage: ConfigIssue = { path: [], messageKey: 'x' }

// The regression this member's NAME exists to prevent. zod's $ZodIssueInvalidElement carries
// `key: unknown`, so naming the member `key` makes a raw ZodError stop satisfying ConfigError —
// which the assertion at the top of this file, and every hand-written safeParse, relies on.
export const stillAssignable = (e: import('zod').ZodError): import('../src/spore.js').ConfigError => e
