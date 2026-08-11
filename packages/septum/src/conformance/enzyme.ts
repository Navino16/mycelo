import { sourceErasabilityFailures } from './erasability.js'
import { parseManifest } from '../manifest.js'
import type { EnzymeModule } from '../enzyme.js'
import type { EnzymeContext, Invocation } from '../context.js'
import type { IncomingMessage } from '../message.js'

export interface EnzymeHarness {
  name: string
  manifest: unknown
  /** Omit for a plugin whose commands all answer with `respond`: it has no module at all. */
  module?: EnzymeModule<unknown>
  /** Absolute paths to the plugin's own source files. See sourceErasabilityFailures. */
  sourcePaths?: readonly string[]
  validConfig?: unknown
  invalidConfig?: unknown
  /** Builds the context the enzyme will receive. The author supplies stubs for
   *  whatever their enzyme actually uses — the kit cannot know its dependencies. */
  context(): EnzymeContext<unknown>
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
  const failures: string[] = [...(await sourceErasabilityFailures(harness.sourcePaths))]

  let manifest
  try {
    manifest = parseManifest(harness.manifest)
  } catch (e) {
    return [...failures, `manifest does not parse: ${(e as Error).message}`]
  }
  if (manifest.kind !== 'enzyme') {
    return [...failures, `manifest kind is '${manifest.kind}', expected 'enzyme'`]
  }

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

  // Each sub-check is gated on its own input, not on validConfig: gating both on
  // validConfig would silently skip the over-permissive-schema check whenever an
  // author supplies only invalidConfig.
  const schema = harness.module.configSchema
  if (schema !== undefined) {
    if (harness.validConfig !== undefined && !schema.safeParse(harness.validConfig).success) {
      failures.push('configSchema rejects the declared valid config')
    }
    if (harness.invalidConfig !== undefined && schema.safeParse(harness.invalidConfig).success) {
      failures.push('configSchema accepts the declared invalid config')
    }
  }

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
      await instance.start(harness.context())
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
    try {
      await handler(invocation, harness.context())
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
