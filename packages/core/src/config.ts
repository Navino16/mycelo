import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'

const ownerSchema = z.object({
  channel: z.string().min(1),
  userId: z.string().min(1),
})

export type OwnerIdentity = z.infer<typeof ownerSchema>

// `ui` still arrives with the phase that needs it. `plugins` is unknown per key: the core
// never knows a spore's config shape — the spore's own configSchema validates it.
const bootstrapSchema = z.object({
  prefix: z.string().min(1).default('/'),
  spores: z.string().default('./fixtures'),
  database: z.string().min(1).default('./mycelo.db'),
  owner: ownerSchema.optional(),
  defaultRole: z.string().min(1).optional(),
  plugins: z.record(z.string(), z.unknown()).default({}),
})

export type Bootstrap = z.infer<typeof bootstrapSchema> & {
  sporesDir: string
  databaseFile: string
}

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
  return {
    ...result.data,
    sporesDir: resolve(file, '..', result.data.spores),
    databaseFile: resolve(file, '..', result.data.database),
  }
}
