import type { CommandSpec, Enzyme, Hypha, HyphaManifest, TranslatableRef } from '@mycelo/septum'
import { dormancyRefusal } from './fault.js'

/**
 * Duck-typed, never instanceof: a spore is bundled with its own copy of everything.
 * `api` is what every enzyme reaches through ctx.rhiza(); a rhiza without it germinates
 * and fails on first use.
 */
export function rhizaShapeError(instance: unknown): TranslatableRef | null {
  if (typeof instance !== 'object' || instance === null) {
    return dormancyRefusal('refusal.germination.createNotObject', { got: String(instance) })
  }
  const record = instance as Record<string, unknown>
  const missing = ['start', 'stop', 'health'].filter((m) => typeof record[m] !== 'function')
  if (missing.length > 0) {
    return dormancyRefusal('refusal.germination.createMissingMethods', { missing: missing.join(', ') })
  }
  if (record['api'] === undefined || record['api'] === null) {
    return dormancyRefusal('refusal.germination.rhizaNoApi')
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
export function hyphaShapeError(instance: unknown, kind: 'hypha'): TranslatableRef | null {
  if (typeof instance !== 'object' || instance === null) {
    return dormancyRefusal('refusal.germination.createNotObject', { got: String(instance) })
  }
  const missing = REQUIRED_METHODS[kind].filter(
    (m) => typeof (instance as Record<string, unknown>)[m] !== 'function',
  )
  return missing.length > 0
    ? dormancyRefusal('refusal.germination.createMissingMethods', { missing: missing.join(', ') })
    : null
}

/**
 * Duck-typed, never instanceof: a spore is bundled with its own copy of everything.
 * `handlers` is a plugin-supplied plain object, so every lookup uses
 * Object.hasOwn — a command named `code: constructor` must not resolve through
 * Object.prototype and pass as if a handler had genuinely been declared.
 */
export function enzymeShapeError(instance: unknown, commands: readonly CommandSpec[]): TranslatableRef | null {
  if (typeof instance !== 'object' || instance === null) {
    return dormancyRefusal('refusal.germination.createNotObject', { got: String(instance) })
  }
  const handlers = (instance as { handlers?: unknown }).handlers
  if (typeof handlers !== 'object' || handlers === null) {
    return dormancyRefusal('refusal.germination.enzymeNoHandlersObject')
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
    return dormancyRefusal('refusal.germination.handlersMissing', { missing: missing.join(', ') })
  }

  // Matches conformance/enzyme.ts: the kit must not certify a pairing the runtime refuses.
  const { start, stop } = instance as { start?: unknown; stop?: unknown }
  if ((start === undefined) !== (stop === undefined)) {
    return dormancyRefusal('refusal.germination.startStopMismatch')
  }
  return null
}

/**
 * Duck-typed, never instanceof: a spore is bundled with its own copy of everything.
 * `inspect` must be callable, not merely present — phase 1's conformance kit checked
 * presence only and certified a broken plugin.
 */
export function inhibitorShapeError(instance: unknown): TranslatableRef | null {
  if (typeof instance !== 'object' || instance === null) {
    return dormancyRefusal('refusal.germination.createNotObject', { got: String(instance) })
  }
  const record = instance as Record<string, unknown>
  if (typeof record['inspect'] !== 'function') {
    return dormancyRefusal('refusal.germination.inhibitorNoInspect')
  }
  if ((record['start'] === undefined) !== (record['stop'] === undefined)) {
    return dormancyRefusal('refusal.germination.startStopMismatch')
  }
  for (const method of ['start', 'stop']) {
    if (record[method] !== undefined && typeof record[method] !== 'function') {
      return dormancyRefusal('refusal.germination.methodNotCallable', { method })
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
export function capabilityShapeError(instance: Record<string, unknown>, manifest: HyphaManifest): TranslatableRef | null {
  const declaresMembership = manifest.capabilities.includes('group_membership')
  const implementsMembership = typeof instance.listGroupMembers === 'function'
  if (declaresMembership && !implementsMembership) {
    return dormancyRefusal('refusal.germination.capabilityUnimplemented')
  }
  if (!declaresMembership && implementsMembership) {
    return dormancyRefusal('refusal.germination.capabilityUndeclared')
  }
  return null
}
