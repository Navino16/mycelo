import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { createServer } from '../../src/api/server.js'
import { SESSION_COOKIE } from '../../src/api/sessions.js'
import { germinatePhase } from '../../src/boot/germinate.js'
import { serve } from '../../src/boot/serve.js'
import type { Served } from '../../src/boot/serve.js'
import { createLogger } from '../../src/support/logger.js'

export interface Booted {
  app: FastifyInstance
  served: Served
}

export function freshDir(): string {
  return mkdtempSync(join(tmpdir(), 'mycelo-api-'))
}

/** `extra` is raw YAML appended to a minimal `mycelo.yaml`; `trustProxy` defaults to off. */
export function boot(dir: string, extra = '', trustProxy = false, sporesDir = './none'): Booted {
  writeFileSync(join(dir, 'mycelo.yaml'), `spores: ${sporesDir}\ndatabase: ./d.db\n${extra}`, 'utf8')
  const served = serve(join(dir, 'mycelo.yaml'))
  const app = createServer({ trustProxy, state: served.state })
  return { app, served }
}

// Same fixtures milestone.test.ts and lifecycle.test.ts germinate against, at the same
// depth: packages/core/test/api is a sibling of packages/core/test/config.
const FIXTURES = resolve(import.meta.dirname, '../../../../fixtures')

export type SporeWriter = (sporesDir: string) => void

function writeSpore(sporesDir: string, name: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const file = join(sporesDir, name, rel)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, content, 'utf8')
  }
}

/** Two rhizas each requiring the other: the smallest real cycle (boot/germinate.test.ts). */
export const cyclingPair: SporeWriter = (sporesDir) => {
  for (const [self, other] of [['alpha', 'beta'], ['beta', 'alpha']] as const) {
    writeSpore(sporesDir, self, {
      'spore.yaml': `kind: rhiza\nname: ${self}\nseptum: "^0.7"\nrequires:\n  - rhiza: ${other}\n`,
    })
  }
}

// Duck-typed like lifecycle.test.ts's needs-config: a spore under /tmp cannot resolve
// the workspace's zod, and a real one carries its own copy anyway.
function configSchemaModule(fields: readonly string[]): string {
  const checks = fields.map((f) => `typeof input?.${f} === 'string' && input.${f}.length > 0`).join(' && ')
  const missingExpr = fields.map((f) => `(typeof input?.${f} === 'string' && input.${f}.length > 0 ? [] : ['${f}'])`).join(', ')
  const properties = fields.map((f) => `${f}: { type: 'string' }`).join(', ')
  return `
    export default {
      configSchema: {
        safeParse: (input) => (${checks})
          ? { success: true, data: input }
          : { success: false, error: 'missing required field(s): ' + [${missingExpr}].flat().join(', ') },
        toJsonSchema: () => ({
          type: 'object',
          properties: { ${properties} },
          required: [${fields.map((f) => `'${f}'`).join(', ')}],
        }),
      },
      create: () => ({ handlers: { handleConfigured: async () => {} } }),
    }
  `
}

function configurableSpore(fields: readonly string[]): SporeWriter {
  return (sporesDir) => {
    writeSpore(sporesDir, 'needs-config', {
      'spore.yaml': 'kind: enzyme\nname: needs-config\nseptum: "^0.7"\n'
        + 'commands:\n  - name: configured\n    description: Report the configured setting\n    code: handleConfigured\n',
      'src/index.ts': configSchemaModule(fields),
    })
  }
}

/** One required setting, `token` — enough to exercise the settings routes and redaction. */
export const configurable: SporeWriter = configurableSpore(['token'])

/** Two required settings: the plural case an `issues[0]` implementation would miss. */
export const configurableTwoFields: SporeWriter = configurableSpore(['url', 'token'])

export interface Credentials {
  username: string
  password: string
}

const DEFAULT_CREDENTIALS: Credentials = { username: 'alice', password: 'correct horse' }

/** Runs the setup wizard and returns a ready-to-use `Cookie` header value. */
export async function setup(app: FastifyInstance, credentials = DEFAULT_CREDENTIALS): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/setup', payload: credentials })
  if (response.statusCode !== 200) {
    throw new Error(`setup failed with ${String(response.statusCode)}: ${response.body}`)
  }
  const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE)
  if (cookie === undefined) throw new Error('setup returned no session cookie')
  return `${SESSION_COOKIE}=${cookie.value}`
}

export async function closeBooted(booted: Booted): Promise<void> {
  await booted.app.close()
  booted.served.closeDb()
}

export interface LoggedIn extends Booted {
  cookie: string
  /** Not removed by `closeBooted`: callers clean it up themselves, as every sibling test does. */
  dir: string
}

export interface BootAndLoginOptions {
  /** Writes its own spores into a fresh directory; omitted boots against the real fixtures. */
  spores?: SporeWriter
}

/**
 * Boots, runs the phase-2 germination `serve()` leaves pending, and completes the setup
 * wizard, so a route test starts already past both gates in `api/context.ts`.
 */
export async function bootAndLogin(options: BootAndLoginOptions = {}): Promise<LoggedIn> {
  const dir = freshDir()
  let sporesDir = FIXTURES
  if (options.spores !== undefined) {
    sporesDir = join(dir, 'spores')
    mkdirSync(sporesDir, { recursive: true })
    options.spores(sporesDir)
  }
  const booted = boot(dir, '', false, sporesDir)
  await germinatePhase(booted.served.state, createLogger())
  const cookie = await setup(booted.app)
  return { ...booted, cookie, dir }
}
