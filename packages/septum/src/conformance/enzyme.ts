import { IntlMessageFormat } from 'intl-messageformat'
import { parseManifest } from '../manifest.js'
import { configSchemaFailures } from './config-checks.js'
import type { EnzymeModule } from '../enzyme.js'
import type { EnzymeManifest } from '../manifest.js'
import type { EnzymeContext, EnzymeStartContext, Invocation, Translate } from '../context.js'
import type { IncomingMessage } from '../message.js'

export interface EnzymeHarness {
  name: string
  manifest: unknown
  /** Omit for a plugin whose commands all answer with `respond`: it has no module at all. */
  module?: EnzymeModule<unknown>
  validConfig?: unknown
  invalidConfig?: unknown
  /** Builds the context the enzyme will receive. The author supplies stubs for
   *  whatever their enzyme actually uses — the kit cannot know its dependencies. */
  context(): EnzymeContext<unknown>
  /** The context `start()` gets. Omit to have the kit narrow `context()` down to it. */
  startContext?(): EnzymeStartContext<unknown>
  /**
   * Already-parsed catalogues, keyed by locale — parseManifest's convention, since the kit
   * must not import `node:fs`. Compiled as germination compiles them (design §7.1), so a
   * message that would make the spore dormant in the bot fails here instead.
   */
  catalogs?: Record<string, unknown>
}

const SHARED_DOMAIN = 'common'
const CORE_DOMAIN = 'core'

// A target may carry a semver range ("radarr@^2"); mirrors anastomoses.ts's targetName.
function targetName(target: string): string {
  const at = target.indexOf('@')
  return at === -1 ? target : target.slice(0, at)
}

function declaredRhizas(manifest: EnzymeManifest): ReadonlySet<string> {
  const names = new Set<string>()
  for (const requirement of manifest.requires ?? []) {
    if ('any_of' in requirement) {
      for (const alt of requirement.any_of) names.add(targetName(alt.rhiza))
    } else {
      names.add(targetName(requirement.rhiza))
    }
  }
  return names
}

// Dotted keys, exactly as the core's catalog.ts flattens them: a catalogue key is a
// single opaque string everywhere else, so the kit and the runtime must agree on what
// one is. Returns the first non-string key found, or null.
function flatten(node: unknown, prefix: string, out: Map<string, string>): string | null {
  if (typeof node === 'string') {
    out.set(prefix, node)
    return null
  }
  if (typeof node !== 'object' || node === null || Array.isArray(node)) return prefix
  for (const [name, child] of Object.entries(node)) {
    const bad = flatten(child, prefix === '' ? name : `${prefix}.${name}`, out)
    if (bad !== null) return bad
  }
  return null
}

function catalogFailures(catalogs: Record<string, unknown> | undefined): string[] {
  if (catalogs === undefined) return []
  const failures: string[] = []
  for (const [locale, raw] of Object.entries(catalogs)) {
    // An empty or comment-only file parses to null: catalog.ts treats that as a
    // catalogue with no keys, not a fault, and the kit must agree.
    if (raw === null || raw === undefined) continue
    const flat = new Map<string, string>()
    const badKey = flatten(raw, '', flat)
    if (badKey !== null) {
      failures.push(`translations for '${locale}': key '${badKey}' is not a string`)
      continue
    }
    for (const [key, message] of flat) {
      try {
        new IntlMessageFormat(message, locale)
      } catch (e) {
        failures.push(`translations for '${locale}': key '${key}' does not compile: ${(e as Error).message}`)
      }
    }
  }
  return failures
}

/**
 * Enforces exactly what bindTranslate enforces at runtime (design §3.1): own domain and
 * 'common' are free, a declared rhiza's domain is free, everything else throws, including
 * 'core'. Without this the kit's stub `t` accepted every domain the runtime refuses.
 */
function guardedT(name: string, allowed: ReadonlySet<string>, inner: Translate): Translate {
  return (key, params, locale) => {
    if (typeof key !== 'string' && key.domain !== name && key.domain !== SHARED_DOMAIN) {
      if (key.domain === CORE_DOMAIN || !allowed.has(key.domain)) {
        throw new Error(`translation domain '${key.domain}' is not declared in this spore's requires`)
      }
    }
    return inner(key, params, locale)
  }
}

/**
 * EnzymeContext extends EnzymeStartContext, so handing start() the fuller one
 * typechecks — and hides that the runtime's has no reply, principal or capabilities.
 * Narrowing by picking members is what makes the kit fail where the bot would.
 */
function startContextFor(
  harness: EnzymeHarness, manifest: EnzymeManifest, allowed: ReadonlySet<string>,
): EnzymeStartContext<unknown> {
  if (harness.startContext !== undefined) return harness.startContext()
  const ctx = harness.context()
  return {
    config: ctx.config,
    logger: ctx.logger,
    push: (target, content) => ctx.push(target, content),
    rhiza<TApi>(name: string): TApi { return ctx.rhiza<TApi>(name) },
    has: (name) => ctx.has(name),
    capabilitiesOf: (target) => ctx.capabilitiesOf(target),
    on: (rhiza, event, handler) => { ctx.on(rhiza, event, handler) },
    t: guardedT(manifest.name, allowed, (key, params, locale) => ctx.t(key, params, locale)),
    localeFor: (target) => ctx.localeFor(target),
  }
}

// Member by member, not `{ ...ctx, t: ... }`: a spread copies only own enumerable
// properties, so a context() returning a class instance would silently lose every
// prototype method (reply, push, rhiza...) — the same reason startContextFor above
// does not spread either.
function withGuardedT(
  ctx: EnzymeContext<unknown>, manifest: EnzymeManifest, allowed: ReadonlySet<string>,
): EnzymeContext<unknown> {
  return {
    config: ctx.config,
    logger: ctx.logger,
    reply: (content) => ctx.reply(content),
    push: (target, content) => ctx.push(target, content),
    rhiza<TApi>(name: string): TApi { return ctx.rhiza<TApi>(name) },
    has: (name) => ctx.has(name),
    capabilitiesOf: (target) => ctx.capabilitiesOf(target),
    on: (rhiza, event, handler) => { ctx.on(rhiza, event, handler) },
    t: guardedT(manifest.name, allowed, (key, params, locale) => ctx.t(key, params, locale)),
    localeFor: (target) => ctx.localeFor(target),
    capabilities: ctx.capabilities,
    principal: ctx.principal,
    locale: ctx.locale,
  }
}

function stubMessage(): IncomingMessage {
  return {
    channel: 'conformance',
    conversationId: 'c:1',
    messageId: 'm:1',
    sender: { channel: 'conformance', externalId: 'tester' },
    text: '',
    attachments: [],
    raw: null,
    receivedAt: new Date(0),
  }
}

export async function enzymeChecks(harness: EnzymeHarness): Promise<string[]> {
  const failures: string[] = []

  let manifest
  try {
    manifest = parseManifest(harness.manifest)
  } catch (e) {
    return [...failures, `manifest does not parse: ${(e as Error).message}`]
  }
  if (manifest.kind !== 'enzyme') {
    return [...failures, `manifest kind is '${manifest.kind}', expected 'enzyme'`]
  }
  failures.push(...catalogFailures(harness.catalogs))
  const allowed = declaredRhizas(manifest)

  const codeCommands = manifest.commands.filter((c) => c.respond === undefined)
  if (harness.module === undefined) {
    // A plugin that is only YAML is a plugin — but every `code:` command still
    // needs a handler to resolve, the same requirement germination enforces
    // before it ever asks a spore for a module.
    if (codeCommands.length > 0) {
      const names = [...new Set(codeCommands.map((c) => c.code))]
      failures.push(`no module supplied, but commands need a handler: ${names.join(', ')}`)
    }
    return failures
  }

  failures.push(
    ...configSchemaFailures(harness.module.configSchema, harness.validConfig, harness.invalidConfig),
  )

  let instance
  try {
    instance = harness.module.create()
  } catch (e) {
    return [...failures, `create() threw: ${(e as Error).message}`]
  }
  if (typeof instance.handlers !== 'object' || instance.handlers === null) {
    failures.push('create() returned no handlers object')
    return failures
  }
  // Object.hasOwn, never a plain index: `handlers` is a plain object the author
  // supplies, so a command declaring `code: constructor` must not resolve through
  // Object.prototype and be certified as having a handler that was never written.
  const table: Record<string, unknown> = instance.handlers
  const missing = [
    ...new Set(
      codeCommands
        .filter((c) => !Object.hasOwn(table, c.code) || typeof table[c.code] !== 'function')
        .map((c) => c.code),
    ),
  ]
  if (missing.length > 0) {
    failures.push(`handlers has no function for: ${missing.join(', ')}`)
    return failures
  }
  if ((instance.start === undefined) !== (instance.stop === undefined)) {
    failures.push('start() and stop() must be both present or both absent')
  }
  // Presence is not callability: a JavaScript enzyme can export a non-callable
  // `start`, which the core would invoke at germination.
  for (const method of ['start', 'stop'] as const) {
    if (instance[method] !== undefined && typeof instance[method] !== 'function') {
      failures.push(`${method} is present but not callable`)
    }
  }

  // start() before any handler, as at germination: an enzyme that memoises a rhiza
  // client in start() would otherwise be reported as broken.
  if (typeof instance.start === 'function') {
    try {
      await instance.start(startContextFor(harness, manifest, allowed))
    } catch (e) {
      return [...failures, `start() threw: ${(e as Error).message}`]
    }
  }

  // Only commands with no required arguments are invoked: the kit cannot invent a
  // value the enzyme would accept, so a correctly-validating one would fail here.
  // Commands with required args are the author's to test. An unreferenced handler
  // produces nothing here: no author action differs for one, so the kit has no
  // warning channel to widen for it.
  for (const command of codeCommands) {
    if (command.args?.some((a) => a.required) === true) continue
    const invocation: Invocation = {
      command: command.name,
      args: {},
      rest: '',
      message: stubMessage(),
    }
    const handler = (Object.hasOwn(table, command.code) ? table[command.code] : undefined) as
      (i: Invocation, ctx: EnzymeContext<unknown>) => Promise<void>
    const ctx = harness.context()
    try {
      await handler(invocation, withGuardedT(ctx, manifest, allowed))
    } catch (e) {
      failures.push(`handler threw for declared command '${command.name}': ${(e as Error).message}`)
    }
  }

  // Closes whatever start() opened, so no timer outlives the check.
  if (typeof instance.stop === 'function') {
    try {
      await instance.stop()
    } catch (e) {
      failures.push(`stop() threw: ${(e as Error).message}`)
    }
  }

  return failures
}
