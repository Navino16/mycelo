import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'

const ownerSchema = z.object({
  channel: z.string().min(1),
  userId: z.string().min(1),
})

export type OwnerIdentity = z.infer<typeof ownerSchema>

// `ui` still arrives with the phase that needs it.
const bootstrapSchema = z.object({
  prefix: z.string().min(1).default('/'),
  spores: z.string().default('./fixtures'),
  database: z.string().min(1).default('./mycelo.db'),
  owner: ownerSchema.optional(),
  defaultRole: z.string().min(1).optional(),
  // Settings moved to the database in phase 5. Rejected rather than dropped: Zod strips
  // unknown keys, so a stale block would take an operator's configuration with it in silence.
  plugins: z.never().optional(),
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
    const path = issue?.path.join('.') ?? ''
    // index.ts prints the message and nothing else, and Zod's text is identical for any
    // field of the same type. `plugins` is named outright: it is this phase's migration.
    const message = path === 'plugins'
      ? "remove the 'plugins:' block from mycelo.yaml — plugin settings now live in the database"
      : `${path === '' ? '' : `${path}: `}${issue?.message ?? 'invalid bootstrap'}`
    throw new BootstrapError(message, path)
  }
  return {
    ...result.data,
    sporesDir: resolve(file, '..', result.data.spores),
    databaseFile: resolve(file, '..', result.data.database),
  }
}
