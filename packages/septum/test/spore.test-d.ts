import { z } from 'zod'
import type { ConfigError } from '../src/spore.js'

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
