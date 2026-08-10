import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'

// Only the fields this phase reads. `database` and `ui` arrive with the phases
// that need them; validating them now would reject a file those phases will write.
const bootstrapSchema = z.object({
  prefix: z.string().min(1).default('/'),
  spores: z.string().default('./fixtures'),
})

export type Bootstrap = z.infer<typeof bootstrapSchema> & { sporesDir: string }

export class BootstrapError extends Error {
  readonly path: string
  constructor(message: string, path: string) {
    super(message)
    this.name = 'BootstrapError'
    this.path = path
  }
}

/** Reads mycelo.yaml. A missing file is not an error: every field has a default. */
export function loadBootstrap(file: string): Bootstrap {
  let raw: unknown = {}
  try {
    raw = parseYaml(readFileSync(file, 'utf8')) ?? {}
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new BootstrapError(`cannot read ${file}: ${(e as Error).message}`, file)
    }
  }
  const result = bootstrapSchema.safeParse(raw)
  if (!result.success) {
    const issue = result.error.issues[0]
    throw new BootstrapError(issue?.message ?? 'invalid bootstrap', issue?.path.join('.') ?? '')
  }
  return { ...result.data, sporesDir: resolve(file, '..', result.data.spores) }
}
