import type { CommandSpec, Enzyme, Hypha, HyphaManifest } from '@mycelo/septum'
import { fault } from './fault.js'
import type { Fault } from './fault.js'

/**
 * Duck-typed, never instanceof: a spore is bundled with its own copy of everything.
 * `api` is what every enzyme reaches through ctx.rhiza(); a rhiza without it germinates
 * and fails on first use.
 */
export function rhizaShapeError(instance: unknown): Fault | null {
  if (typeof instance !== 'object' || instance === null) {
    return fault(`create() returned ${String(instance)}, expected an object`,
      'refusal.germination.createNotObject', { got: String(instance) })
  }
  const record = instance as Record<string, unknown>
  const missing = ['start', 'stop', 'health'].filter((m) => typeof record[m] !== 'function')
  if (missing.length > 0) {
    return fault(`create() returned no ${missing.join(', ')}`,
      'refusal.germination.createMissingMethods', { missing: missing.join(', ') })
  }
  if (record['api'] === undefined || record['api'] === null) {
    return fault('create() returned no api — enzymes would resolve undefined through ctx.rhiza()',
      'refusal.germination.rhizaNoApi')
  }
  return null
}

// satisfies keeps this list bound to Hypha's own member names: a rename there now
// fails the build here instead of silently sending every hypha dormant.
const REQUIRED_METHODS = {
  hypha: ['connect', 'listen', 'stop', 'send'],
} as const satisfies { hypha: readonly (keyof Hypha)[] }

/**
 * Duck-typed, never instanceof: a spore is bundled with its own copy of everything.
 * Without this the cast below would register an instance nothing has checked, and the
 * failure would surface on the first message instead of at germination.
 */
export function hyphaShapeError(instance: unknown, kind: 'hypha'): Fault | null {
  if (typeof instance !== 'object' || instance === null) {
    return fault(`create() returned ${String(instance)}, expected an object`,
      'refusal.germination.createNotObject', { got: String(instance) })
  }
  const missing = REQUIRED_METHODS[kind].filter(
    (m) => typeof (instance as Record<string, unknown>)[m] !== 'function',
  )
  return missing.length > 0
    ? fault(`create() returned no ${missing.join(', ')}`,
      'refusal.germination.createMissingMethods', { missing: missing.join(', ') })
    : null
}

/**
 * Duck-typed, never instanceof: a spore is bundled with its own copy of everything.
 * `handlers` is a plugin-supplied plain object, so every lookup uses
 * Object.hasOwn — a command named `code: constructor` must not resolve through
 * Object.prototype and pass as if a handler had genuinely been declared.
 */
export function enzymeShapeError(instance: unknown, commands: readonly CommandSpec[]): Fault | null {
  if (typeof instance !== 'object' || instance === null) {
    return fault(`create() returned ${String(instance)}, expected an object`,
      'refusal.germination.createNotObject', { got: String(instance) })
  }
  const handlers = (instance as { handlers?: unknown }).handlers
  if (typeof handlers !== 'object' || handlers === null) {
    return fault('create() returned no handlers object', 'refusal.germination.enzymeNoHandlersObject')
  }
  const table = handlers as Record<string, unknown>
  const missing = [
    ...new Set(
      commands
        .filter((c) => c.respond === undefined)
        .map((c) => c.code)
        .filter((name) => !Object.hasOwn(table, name) || typeof table[name] !== 'function'),
    ),
  ]
  if (missing.length > 0) {
    return fault(`handlers has no function for: ${missing.join(', ')}`,
      'refusal.germination.handlersMissing', { missing: missing.join(', ') })
  }

  // Matches conformance/enzyme.ts: the kit must not certify a pairing the runtime refuses.
  const { start, stop } = instance as { start?: unknown; stop?: unknown }
  if ((start === undefined) !== (stop === undefined)) {
    return fault('start() and stop() must be both present or both absent',
      'refusal.germination.startStopMismatch')
  }
  return null
}

/**
 * Duck-typed, never instanceof: a spore is bundled with its own copy of everything.
 * `inspect` must be callable, not merely present — phase 1's conformance kit checked
 * presence only and certified a broken plugin.
 */
export function inhibitorShapeError(instance: unknown): Fault | null {
  if (typeof instance !== 'object' || instance === null) {
    return fault(`create() returned ${String(instance)}, expected an object`,
      'refusal.germination.createNotObject', { got: String(instance) })
  }
  const record = instance as Record<string, unknown>
  if (typeof record['inspect'] !== 'function') {
    return fault('create() returned no inspect()', 'refusal.germination.inhibitorNoInspect')
  }
  if ((record['start'] === undefined) !== (record['stop'] === undefined)) {
    return fault('start() and stop() must be both present or both absent',
      'refusal.germination.startStopMismatch')
  }
  for (const method of ['start', 'stop']) {
    if (record[method] !== undefined && typeof record[method] !== 'function') {
      return fault(`${method} is present but not callable`,
        'refusal.germination.methodNotCallable', { method })
    }
  }
  return null
}

/** Dead code is not a broken plugin: warn and germinate (spec, "An unreferenced handler"). */
export function unreferencedHandlers(instance: Enzyme, commands: readonly CommandSpec[]): string[] {
  const referenced = new Set(commands.filter((c) => c.respond === undefined).map((c) => c.code))
  return Object.keys(instance.handlers).filter((name) => !referenced.has(name))
}

/**
 * Matches packages/septum/src/conformance/hypha.ts in both verdicts: the core must not accept a
 * plugin its own published kit would reject. The kit answers a string and this answers a ref —
 * `hyphaChecks` gaining `catalogs` is on the 9.7 list (design §10), and only the wording differs.
 */
export function capabilityShapeError(instance: Record<string, unknown>, manifest: HyphaManifest): Fault | null {
  const declaresMembership = manifest.capabilities.includes('group_membership')
  const implementsMembership = typeof instance.listGroupMembers === 'function'
  if (declaresMembership && !implementsMembership) {
    return fault('manifest declares group_membership but there is no listGroupMembers()',
      'refusal.germination.capabilityUnimplemented')
  }
  if (!declaresMembership && implementsMembership) {
    return fault('listGroupMembers() exists but the manifest does not declare group_membership',
      'refusal.germination.capabilityUndeclared')
  }
  return null
}
