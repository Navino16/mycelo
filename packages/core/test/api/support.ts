import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { createServer } from '../../src/api/server.js'
import { SESSION_COOKIE } from '../../src/api/sessions.js'
import { germinatePhase } from '../../src/boot/germinate.js'
import { serve } from '../../src/boot/serve.js'
import type { Served } from '../../src/boot/serve.js'
import { migrateDatabase, openDatabase } from '../../src/persistence/db.js'
import { role } from '../../src/persistence/schema.js'
import { createLogger } from '../../src/support/logger.js'

export interface Booted {
  app: FastifyInstance
  served: Served
}

export function freshDir(): string {
  return mkdtempSync(join(tmpdir(), 'mycelo-api-'))
}

/**
 * `extra` is raw YAML appended to a minimal `mycelo.yaml`; `trustProxy` defaults to off.
 * `beforeServe`, if given, runs against the database file before `serve()` opens it —
 * for seeding a row `bootstrapIdentity` must find already there (e.g. a configured
 * `defaultRole` that has to name an existing role or `serve()` itself throws).
 * `uiRoots`, if given, overrides `createServer`'s static roots — a test seam for the
 * dist/public fallback order, never operator config.
 */
export function boot(
  dir: string, extra = '', trustProxy = false, sporesDir = './none',
  beforeServe?: (dbFile: string) => void, uiRoots?: string[],
): Booted {
  writeFileSync(join(dir, 'mycelo.yaml'), `spores: ${sporesDir}\ndatabase: ./d.db\n${extra}`, 'utf8')
  beforeServe?.(join(dir, 'd.db'))
  const served = serve(join(dir, 'mycelo.yaml'))
  const app = createServer({ trustProxy, state: served.state, uiRoots })
  return { app, served }
}

// Same fixtures milestone.test.ts and lifecycle.test.ts germinate against, at the same
// depth: packages/core/test/api is a sibling of packages/core/test/config.
export const FIXTURES = resolve(import.meta.dirname, '../../../../fixtures')

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

/**
 * `cyclingPair` plus `gamma`, an enzyme requiring `alpha` alone — disabling `gamma`
 * removes it from the graph entirely but leaves the alpha/beta cycle intact, the case
 * where a retry names a shorter cycle instead of succeeding (spec §4.2).
 */
export const cyclingTriple: SporeWriter = (sporesDir) => {
  cyclingPair(sporesDir)
  writeSpore(sporesDir, 'gamma', {
    'spore.yaml': 'kind: enzyme\nname: gamma\nseptum: "^0.7"\ncommands:\n'
      + '  - name: noop\n    description: No-op\n    respond: noop.text\n'
      + 'requires:\n  - rhiza: alpha\n',
  })
}

// Missing `septum`, same as lifecycle.test.ts's 'brokenyaml': the manifest never parses,
// so the registry.dormant entry it produces carries no kind at all.
export const brokenManifest: SporeWriter = (sporesDir) => {
  writeSpore(sporesDir, 'brokenyaml', { 'spore.yaml': 'kind: enzyme\nname: brokenyaml\n' })
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
          : { success: false, error: { issues: [${missingExpr}].flat()
              .map((f) => ({ path: [f], message: 'missing required field' })) } },
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

/**
 * A plugin with a configSchema but **no** `toJsonSchema` — `formSchemaFor` answers
 * `available: false, reason: 'this plugin publishes no JSON Schema: configure it by hand'`.
 * The route must then write whatever it is given: that is what "by hand" means.
 */
export const noJsonSchema: SporeWriter = (sporesDir) => {
  writeSpore(sporesDir, 'freeform', {
    'spore.yaml': 'kind: enzyme\nname: freeform\nseptum: "^0.7"\n'
      + 'commands:\n  - name: freeform\n    description: Report the configured setting\n    code: handleConfigured\n',
    'src/index.ts': `
      export default {
        configSchema: { safeParse: (input) => ({ success: true, data: input }) },
        create: () => ({ handlers: { handleConfigured: async () => {} } }),
      }
    `,
  })
}

/**
 * A **closed** schema: `additionalProperties: false`, what `z.strictObject` emits. Distinct
 * from every other fixture here, which emits no `additionalProperties` at all — so it is the
 * only one that tells the two halves of `undeclaredKeys`'s `open` check apart.
 */
export const closedJsonSchema: SporeWriter = (sporesDir) => {
  writeSpore(sporesDir, 'strict', {
    'spore.yaml': 'kind: enzyme\nname: strict\nseptum: "^0.7"\n'
      + 'commands:\n  - name: strict\n    description: Report the configured setting\n    code: handleConfigured\n',
    'src/index.ts': `
      export default {
        configSchema: {
          safeParse: (input) => ({ success: true, data: input }),
          toJsonSchema: () => ({
            type: 'object',
            properties: { token: { type: 'string' } },
            additionalProperties: false,
          }),
        },
        create: () => ({ handlers: { handleConfigured: async () => {} } }),
      }
    `,
  })
}

/**
 * A whole-object schema that also exposes a permissive per-field `shape` — every field's own
 * `safeParse` accepts anything, unlike the whole-object one, which refuses `port` when it is
 * not a number. Nothing in the core reads `.shape` any more; this fixture exists so that if
 * the branch is ever reintroduced it does not silently bypass the whole-object check (task 2's
 * review, finding 3) — a `fieldRejections` reading this permissive `shape` would report no
 * rejection at all, where `objectRejections` correctly refuses `port`.
 */
export const mixedFieldSchema: SporeWriter = (sporesDir) => {
  writeSpore(sporesDir, 'mixed', {
    'spore.yaml': 'kind: enzyme\nname: mixed\nseptum: "^0.8"\n'
      + 'commands:\n  - name: mixed\n    description: Report the configured setting\n    code: handleConfigured\n',
    'src/index.ts': `
      const permissive = { safeParse: (v) => ({ success: true, data: v }) }
      export default {
        configSchema: {
          shape: { port: permissive, label: permissive },
          safeParse: (input) => {
            const issues = []
            if (typeof input?.port !== 'number') {
              issues.push({ path: ['port'], message: 'expected a number' })
            }
            if (input?.label !== undefined && typeof input.label !== 'string') {
              issues.push({ path: ['label'], message: 'expected a string' })
            }
            return issues.length === 0
              ? { success: true, data: input }
              : { success: false, error: { issues } }
          },
          toJsonSchema: () => ({
            type: 'object',
            properties: { port: { type: 'number' }, label: { type: 'string' } },
            required: ['port'],
          }),
        },
        create: () => ({ handlers: { handleConfigured: async () => {} } }),
      }
    `,
  })
}

/**
 * No `shape`, only the whole-object `safeParse` that `defineConfig` publishes — the shape
 * every plugin written the documented way has. `port` is required and must be a number.
 */
export const definedSchema: SporeWriter = (sporesDir) => {
  writeSpore(sporesDir, 'defined', {
    'spore.yaml': 'kind: enzyme\nname: defined\nseptum: "^0.7"\n'
      + 'commands:\n  - name: defined\n    description: Report the configured setting\n    code: handleConfigured\n',
    'src/index.ts': `
      export default {
        configSchema: {
          safeParse: (input) => {
            const issues = []
            if (typeof input?.port !== 'number') {
              issues.push({ code: 'invalid_type', path: ['port'], message: 'expected a number' })
            }
            if (input?.label !== undefined && typeof input.label !== 'string') {
              issues.push({ code: 'invalid_type', path: ['label'], message: 'expected a string' })
            }
            return issues.length === 0
              ? { success: true, data: input }
              : { success: false, error: { issues } }
          },
          toJsonSchema: () => ({
            type: 'object',
            properties: { port: { type: 'number' }, label: { type: 'string' } },
            required: ['port'],
          }),
        },
        create: () => ({ handlers: { handleConfigured: async () => {} } }),
      }
    `,
  })
}

// Two plugins, two commands each, and every command name disjoint from its plugin's own
// name — a fixture where a plugin's name equalled one of its commands could not tell
// grouping (by plugin) apart from naming (of the command) if either collapsed. Each
// description is a real catalogue key so the route's translate() call finds it and the
// test output carries no "no translation for" warning.
export const twoPluginsTwoCommands: SporeWriter = (sporesDir) => {
  writeSpore(sporesDir, 'greeter', {
    'spore.yaml': 'kind: enzyme\nname: greeter\nseptum: "^0.7"\ncommands:\n'
      + '  - name: hello\n    description: command.hello.description\n    respond: hello.text\n'
      + '  - name: farewell\n    description: command.farewell.description\n    respond: farewell.text\n',
    'translations/en.yaml': 'command:\n  hello:\n    description: Say hello\n  farewell:\n    description: Say goodbye\n'
      + 'hello:\n  text: Hi\nfarewell:\n  text: Bye\n',
  })
  writeSpore(sporesDir, 'counter', {
    'spore.yaml': 'kind: enzyme\nname: counter\nseptum: "^0.7"\ncommands:\n'
      + '  - name: tally\n    description: command.tally.description\n    respond: tally.text\n'
      + '  - name: reset\n    description: command.reset.description\n    respond: reset.text\n',
    'translations/en.yaml': 'command:\n  tally:\n    description: Count things\n  reset:\n    description: Reset the count\n'
      + 'tally:\n  text: Counted\nreset:\n  text: Zeroed\n',
  })
}

// One plugin, two commands, one declaring a capability and one declaring none — the
// plural case for CommandDto.capabilities, self-contained so it carries no warning from
// any other fixture's untranslated description.
export const capabilityCommand: SporeWriter = (sporesDir) => {
  writeSpore(sporesDir, 'signaler', {
    'spore.yaml': 'kind: enzyme\nname: signaler\nseptum: "^0.7"\ncommands:\n'
      + '  - name: plain\n    description: command.plain.description\n    respond: plain.text\n'
      + '  - name: flagged\n    description: command.flagged.description\n    respond: flagged.text\n'
      + '    capabilities: [reactions]\n',
    'translations/en.yaml': 'command:\n  plain:\n    description: Plain command\n  flagged:\n    description: Flagged command\n'
      + 'plain:\n  text: ok\nflagged:\n  text: ok\n',
  })
}

// One command whose description is a real catalogue key with distinct en/fr text — the
// fixture for proving /api/commands renders through the declaring plugin's own domain,
// in the reader's locale, without the noise of every other fixture's untranslated ones.
export const translatedCommand: SporeWriter = (sporesDir) => {
  writeSpore(sporesDir, 'announcer', {
    'spore.yaml': 'kind: enzyme\nname: announcer\nseptum: "^0.7"\ncommands:\n'
      + '  - name: shout\n    description: command.shout.description\n    respond: shout.text\n',
    'translations/en.yaml': 'command:\n  shout:\n    description: Announce loudly\nshout:\n  text: Loud!\n',
    'translations/fr.yaml': 'command:\n  shout:\n    description: Annoncer bruyamment\nshout:\n  text: Fort !\n',
  })
}

// Duck-typed, no septum import: a spore under /tmp has no node_modules to resolve it
// through. Satisfies rhizaShapeError's three required methods and a non-null api.
const RHIZA_STUB = `
  export default {
    create: () => ({
      start: () => Promise.resolve(),
      stop: () => Promise.resolve(),
      health: () => Promise.resolve({ state: 'healthy', checkedAt: new Date() }),
      api: {},
    }),
  }
`

/**
 * A rhiza whose `health()` rejects: spec §11's "counts as unhealthy, never as a failed
 * request". Duck-typed like RHIZA_STUB, which it cannot reuse — it differs in that method.
 */
export const unhealthyRhiza: SporeWriter = (sporesDir) => {
  writeSpore(sporesDir, 'flapping', {
    'spore.yaml': 'kind: rhiza\nname: flapping\nseptum: "^0.7"\n',
    'src/index.ts': `
      export default {
        create: () => ({
          start: () => Promise.resolve(),
          stop: () => Promise.resolve(),
          health: () => Promise.reject(new Error('connection refused')),
          api: {},
        }),
      }
    `,
  })
}

/**
 * `cyclingPair` plus a module each. `enablePlugin` imports the module, so a module-less
 * spore cannot be enabled through `POST /api/plugins/:name/enable`; cycle detection still
 * precedes every import, so the pair cycles all the same (milestone, spec §15 steps 6-8).
 */
export const cyclingPairWithModules: SporeWriter = (sporesDir) => {
  cyclingPair(sporesDir)
  for (const name of ['alpha', 'beta']) writeSpore(sporesDir, name, { 'src/index.ts': RHIZA_STUB })
}

// One enzyme, two rhizas. `sideconn` is reached by one plain optional requirement —
// mandatory-versus-optional across two distinct targets. `coreconn` is reached by *two*
// requirements with *conflicting* optionality: an any_of (whose chosen alternative
// anastomoses.ts always treats as mandatory) and a separate plain optional requirement
// naming it directly. That is the shape /api/graph's edgesOf must both dedupe (one edge,
// not two) and merge correctly (mandatory wins over optional). The any_of is listed
// first so a naive "last write wins" merge — as opposed to the correct AND — would
// answer optional for coreconn instead of mandatory, and so be caught.
export const mandatoryAndOptionalDependency: SporeWriter = (sporesDir) => {
  writeSpore(sporesDir, 'coreconn', {
    'spore.yaml': 'kind: rhiza\nname: coreconn\nseptum: "^0.7"\n', 'src/index.ts': RHIZA_STUB,
  })
  writeSpore(sporesDir, 'sideconn', {
    'spore.yaml': 'kind: rhiza\nname: sideconn\nseptum: "^0.7"\n', 'src/index.ts': RHIZA_STUB,
  })
  writeSpore(sporesDir, 'grapher', {
    // A respond: command needs no module (enzymeManifestSchema requires at least one command).
    'spore.yaml': 'kind: enzyme\nname: grapher\nseptum: "^0.7"\ncommands:\n'
      + '  - name: noop\n    description: No-op\n    respond: noop.text\n'
      + 'requires:\n'
      + '  - any_of:\n      - rhiza: nowhere\n      - rhiza: coreconn\n'
      + '  - rhiza: coreconn\n    optional: true\n'
      + '  - rhiza: sideconn\n    optional: true\n',
  })
}

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
  /** Extra YAML appended to mycelo.yaml, e.g. 'defaultRole: guest\n'. */
  config?: string
  /**
   * A plain role of this name is inserted before boot. Needed whenever `config` names a
   * `defaultRole`: `bootstrapIdentity` throws a `StartupError` if that role does not already
   * exist, before this helper ever gets to open a session.
   */
  seedRole?: string
}

/**
 * A whole-object refusal — `path: []` — which is what a top-level Zod `.refine()` emits and
 * what septum documents. Both keys are declared, so `undeclaredKeys` cannot be what refuses.
 */
export const eitherOrSchema: SporeWriter = (sporesDir) => {
  writeSpore(sporesDir, 'eitheror', {
    'spore.yaml': 'kind: enzyme\nname: eitheror\nseptum: "^0.8"\n'
      + 'commands:\n  - name: eitheror\n    description: command.eitheror.description\n    code: handleConfigured\n',
    'translations/en.yaml': 'command:\n  eitheror:\n    description: Report the configured setting\n',
    'src/index.ts': `
      export default {
        configSchema: {
          safeParse: (input) => (input?.socket === undefined || input?.tcp === undefined
            ? { success: true, data: input }
            : { success: false, error: { issues: [{ path: [], message: 'socket or tcp, not both' }] } }),
          toJsonSchema: () => ({
            type: 'object',
            properties: { socket: { type: 'string' }, tcp: { type: 'string' } },
          }),
        },
        create: () => ({ handlers: { handleConfigured: async () => {} } }),
      }
    `,
  })
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
  const seedRole = options.seedRole
  const beforeServe = seedRole === undefined ? undefined : (dbFile: string): void => {
    const { db, close } = openDatabase(dbFile)
    migrateDatabase(db)
    db.insert(role).values({ id: crypto.randomUUID(), name: seedRole }).run()
    close()
  }
  const booted = boot(dir, options.config ?? '', false, sporesDir, beforeServe)
  await germinatePhase(booted.served.state, createLogger())
  const cookie = await setup(booted.app)
  return { ...booted, cookie, dir }
}
