import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { canonicalLocale } from './i18n/locale.js'

const ownerSchema = z.object({
  channel: z.string().min(1),
  userId: z.string().min(1),
})

export type OwnerIdentity = z.infer<typeof ownerSchema>

const uiSchema = z.object({
  bind: z.string().min(1).default('127.0.0.1'),
  port: z.number().int().min(1).max(65535).default(8730),
  // False is the only default that is safe when wrong (spec §6.7): with a proxy and
  // `false` the login limiter counts every attacker as one client; without a proxy and
  // `true` a client sets its own X-Forwarded-For and the limiter protects nothing.
  trustProxy: z.boolean().default(false),
  /** Deletes every UI credential at boot so the setup wizard runs again (spec §6.6). */
  resetAccount: z.boolean().default(false),
})

export type UiConfig = z.infer<typeof uiSchema>

const bootstrapSchema = z.object({
  prefix: z.string().min(1).default('/'),
  spores: z.string().default('./fixtures'),
  database: z.string().min(1).default('./mycelo.db'),
  owner: ownerSchema.optional(),
  defaultRole: z.string().min(1).optional(),
  defaultLocale: z.string().min(1).default('en'),
  // Settings moved to the database in phase 5. Rejected rather than dropped: Zod strips
  // unknown keys, so a stale block would take an operator's configuration with it in silence.
  plugins: z.never().optional(),
  // .prefault(), not .default(): Zod v4's .default() returns an undefined-tested value
  // verbatim without re-parsing it, so `.default({})` would skip every inner field's own
  // default and yield `{}`. .prefault() parses the fallback through the schema.
  ui: uiSchema.prefault({}),
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
      ? `remove the 'plugins:' block from ${file} — plugin settings now live in the database`
      : `${path === '' ? '' : `${path}: `}${issue?.message ?? 'invalid bootstrap'}`
    throw new BootstrapError(message, path)
  }
  let defaultLocale: string
  try {
    defaultLocale = canonicalLocale(result.data.defaultLocale)
  } catch (e) {
    throw new BootstrapError((e as Error).message, 'defaultLocale')
  }
  return {
    ...result.data,
    defaultLocale,
    sporesDir: resolve(file, '..', result.data.spores),
    databaseFile: resolve(file, '..', result.data.database),
  }
}
