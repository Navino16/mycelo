import type { CommandSpec, Enzyme, Hypha, HyphaManifest } from '@mycelo/septum'

/**
 * Duck-typed, never instanceof: a spore is bundled with its own copy of everything.
 * `api` is what every enzyme reaches through ctx.rhiza(); a rhiza without it germinates
 * and fails on first use.
 */
export function rhizaShapeError(instance: unknown): string | null {
  if (typeof instance !== 'object' || instance === null) {
    return `create() returned ${String(instance)}, expected an object`
  }
  const record = instance as Record<string, unknown>
  const missing = ['start', 'stop', 'health'].filter((m) => typeof record[m] !== 'function')
  if (missing.length > 0) return `create() returned no ${missing.join(', ')}`
  if (record['api'] === undefined || record['api'] === null) {
    return 'create() returned no api — enzymes would resolve undefined through ctx.rhiza()'
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
export function hyphaShapeError(instance: unknown, kind: 'hypha'): string | null {
  if (typeof instance !== 'object' || instance === null) {
    return `create() returned ${String(instance)}, expected an object`
  }
  const missing = REQUIRED_METHODS[kind].filter(
    (m) => typeof (instance as Record<string, unknown>)[m] !== 'function',
  )
  return missing.length > 0 ? `create() returned no ${missing.join(', ')}` : null
}

/**
 * Duck-typed, never instanceof: a spore is bundled with its own copy of everything.
 * `handlers` is a plugin-supplied plain object, so every lookup uses
 * Object.hasOwn — a command named `code: constructor` must not resolve through
 * Object.prototype and pass as if a handler had genuinely been declared.
 */
export function enzymeShapeError(instance: unknown, commands: readonly CommandSpec[]): string | null {
  if (typeof instance !== 'object' || instance === null) {
    return `create() returned ${String(instance)}, expected an object`
  }
  const handlers = (instance as { handlers?: unknown }).handlers
  if (typeof handlers !== 'object' || handlers === null) {
    return 'create() returned no handlers object'
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
  if (missing.length > 0) return `handlers has no function for: ${missing.join(', ')}`

  // Matches conformance/enzyme.ts: the kit must not certify a pairing the runtime refuses.
  const { start, stop } = instance as { start?: unknown; stop?: unknown }
  if ((start === undefined) !== (stop === undefined)) {
    return 'start() and stop() must be both present or both absent'
  }
  return null
}

/** Dead code is not a broken plugin: warn and germinate (spec, "An unreferenced handler"). */
export function unreferencedHandlers(instance: Enzyme, commands: readonly CommandSpec[]): string[] {
  const referenced = new Set(commands.filter((c) => c.respond === undefined).map((c) => c.code))
  return Object.keys(instance.handlers).filter((name) => !referenced.has(name))
}

/**
 * Matches packages/septum/src/conformance/hypha.ts exactly, in both directions: the
 * core must not accept a plugin its own published kit would reject. Without this, a
 * hypha could declare group_membership with no listGroupMembers(), and
 * ctx.capabilities.has('group_membership') would answer true for a channel that
 * cannot honour it.
 */
export function capabilityShapeError(instance: Record<string, unknown>, manifest: HyphaManifest): string | null {
  const declaresMembership = manifest.capabilities.includes('group_membership')
  const implementsMembership = typeof instance.listGroupMembers === 'function'
  if (declaresMembership && !implementsMembership) {
    return 'manifest declares group_membership but there is no listGroupMembers()'
  }
  if (!declaresMembership && implementsMembership) {
    return 'listGroupMembers() exists but the manifest does not declare group_membership'
  }
  return null
}
