import { sourceErasabilityFailures } from './erasability.js'
import { parseManifest } from '../manifest.js'
import type { Inhibitor, InhibitorModule, Verdict } from '../inhibitor.js'
import type { InhibitorContext } from '../context.js'
import type { IncomingMessage } from '../message.js'

export interface InhibitorHarness {
  name: string
  manifest: unknown
  /** See the note on HyphaHarness.module for why the config is `unknown`. */
  module: InhibitorModule<unknown>
  /** Absolute paths to the plugin's own source files. See sourceErasabilityFailures. */
  sourcePaths?: readonly string[]
  validConfig?: unknown
  invalidConfig?: unknown
  context(): InhibitorContext<unknown>
  /** Messages the inhibitor is expected to allow, and to deny. */
  allowed: IncomingMessage[]
  denied: IncomingMessage[]
}

/**
 * Renders a value for a failure message without ever throwing. JSON.stringify
 * throws on circular structures and on BigInt, both plausible here.
 */
function render(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return Object.prototype.toString.call(value)
  }
}

export async function inhibitorChecks(harness: InhibitorHarness): Promise<string[]> {
  const failures: string[] = [...(await sourceErasabilityFailures(harness.sourcePaths))]

  let manifest
  try {
    manifest = parseManifest(harness.manifest)
  } catch (e) {
    return [...failures, `manifest does not parse: ${(e as Error).message}`]
  }
  if (manifest.kind !== 'inhibitor') {
    return [...failures, `manifest kind is '${manifest.kind}', expected 'inhibitor'`]
  }

  const schema = harness.module.configSchema
  if (schema !== undefined) {
    if (harness.validConfig !== undefined && !schema.safeParse(harness.validConfig).success) {
      failures.push('configSchema rejects the declared valid config')
    }
    if (harness.invalidConfig !== undefined && schema.safeParse(harness.invalidConfig).success) {
      failures.push('configSchema accepts the declared invalid config')
    }
  }

  let instance: Inhibitor<unknown>
  try {
    instance = harness.module.create()
  } catch (e) {
    return [...failures, `create() threw: ${(e as Error).message}`]
  }
  if (typeof instance.inspect !== 'function') {
    return [...failures, 'create() returned no inspect()']
  }
  if ((instance.start === undefined) !== (instance.stop === undefined)) {
    failures.push('start() and stop() must be both present or both absent')
  }
  // Presence is not callability. See the same check in enzymeChecks.
  for (const method of ['start', 'stop'] as const) {
    if (instance[method] !== undefined && typeof instance[method] !== 'function') {
      failures.push(`${method} is present but not callable`)
    }
  }

  // start() before inspect(), as at germination: an inhibitor that loads its
  // allowlist in start() would otherwise be reported as broken.
  if (typeof instance.start === 'function') {
    try {
      await instance.start(harness.context())
    } catch (e) {
      return [...failures, `start() threw: ${(e as Error).message}`]
    }
  }

  /**
   * Calls inspect() and validates the shape of what comes back. A JavaScript
   * plugin gets no help from the type, so a missing `reason` — or no verdict at
   * all — must become a failure message rather than a TypeError.
   */
  async function verdictOf(message: IncomingMessage): Promise<Verdict | string> {
    let raw: unknown
    try {
      raw = await instance.inspect(message, harness.context())
    } catch (e) {
      return `inspect() threw: ${(e as Error).message}`
    }
    if (typeof raw !== 'object' || raw === null || !('allow' in raw)) {
      return `inspect() returned ${render(raw)}, expected a Verdict`
    }
    const v = raw as { allow: unknown; reason?: unknown }
    if (typeof v.allow !== 'boolean') {
      return `inspect() returned a non-boolean 'allow'`
    }
    if (v.allow === false && typeof v.reason !== 'string') {
      return 'denied without a reason string — the core surfaces this text to the operator'
    }
    return v.allow ? { allow: true } : { allow: false, reason: v.reason as string }
  }

  for (const message of harness.allowed) {
    const verdict = await verdictOf(message)
    if (typeof verdict === 'string') {
      failures.push(verdict)
    } else if (!verdict.allow) {
      failures.push(`denied a message expected to be allowed: ${verdict.reason}`)
    }
  }

  for (const message of harness.denied) {
    const verdict = await verdictOf(message)
    if (typeof verdict === 'string') {
      failures.push(verdict)
    } else if (verdict.allow) {
      failures.push('allowed a message expected to be denied')
    } else if (verdict.reason.trim() === '') {
      failures.push('denied with an empty reason — the core surfaces this text to the operator')
    }
  }

  // Closes whatever start() opened, so no watcher outlives the check.
  if (typeof instance.stop === 'function') {
    try {
      await instance.stop()
    } catch (e) {
      failures.push(`stop() threw: ${(e as Error).message}`)
    }
  }

  return failures
}
