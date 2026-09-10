import { septumIncompatibility } from '../compat.js'
import { parseManifest } from '../manifest.js'
import { configSchemaFailures } from './config-checks.js'
import { healthFailures } from './health-checks.js'
import type { Rhiza, RhizaModule } from '../rhiza.js'

export interface RhizaHarness {
  name: string
  manifest: unknown
  /** See the note on HyphaHarness.module for why the config is `unknown`. */
  module: RhizaModule<unknown, unknown>
  validConfig?: unknown
  invalidConfig?: unknown
  /**
   * Already-parsed catalogues, keyed by locale — parseManifest's convention, since the kit must not
   * import `node:fs`. Supplying them lets the config check see a refusal key that resolves nowhere
   * (design §6). Their own compilation is not checked here yet: that is the wider 9.7 item.
   */
  catalogs?: Record<string, unknown>
}

/**
 * Contract compliance for a rhiza. Checks the shape of the plugin, never its
 * domain behaviour: the kit cannot know what Radarr should return, but it can
 * know that health() must report one of three states.
 */
export async function rhizaChecks(harness: RhizaHarness): Promise<string[]> {
  const failures: string[] = []

  let manifest
  try {
    manifest = parseManifest(harness.manifest)
  } catch (e) {
    return [...failures, `manifest does not parse: ${(e as Error).message}`]
  }
  if (manifest.kind !== 'rhiza') {
    return [...failures, `manifest kind is '${manifest.kind}', expected 'rhiza'`]
  }

  // The same check germination, enablePlugin and inoculate apply: a kit that certifies a range
  // the runtime refuses fails the author at the operator's install instead of at authoring time.
  const incompatible = septumIncompatibility(manifest.septum)
  if (incompatible !== undefined) failures.push(`the manifest ${incompatible}`)

  failures.push(
    ...configSchemaFailures(harness.module.configSchema, harness.validConfig, harness.invalidConfig, harness.catalogs),
  )

  let instance: Rhiza<unknown, unknown>
  try {
    instance = harness.module.create()
  } catch (e) {
    return [...failures, `create() threw: ${(e as Error).message}`]
  }

  for (const method of ['start', 'stop', 'health'] as const) {
    if (typeof instance[method] !== 'function') {
      failures.push(`create() returned no ${method}()`)
    }
  }
  // `api` is what every enzyme reaches through ctx.rhiza(). A rhiza without it
  // germinates and then fails on first use, which is the failure this catches.
  if (instance.api === undefined || instance.api === null) {
    failures.push('create() returned no api — enzymes would resolve undefined through ctx.rhiza()')
  }

  failures.push(...await healthFailures(instance))

  // The core calls stop() during shutdown regardless of how germination went.
  if (typeof instance.stop === 'function') {
    try {
      await instance.stop()
    } catch (e) {
      failures.push(`stop() throws when start() never ran: ${(e as Error).message}`)
    }
  }

  return failures
}
