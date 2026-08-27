import { septumIncompatibility } from '../compat.js'
import { parseManifest } from '../manifest.js'
import { configSchemaFailures } from './config-checks.js'
import type { HealthState } from '../context.js'
import type { Rhiza, RhizaModule } from '../rhiza.js'

const HEALTH_STATES: readonly HealthState[] = ['healthy', 'degraded', 'unreachable']

export interface RhizaHarness {
  name: string
  manifest: unknown
  /** See the note on HyphaHarness.module for why the config is `unknown`. */
  module: RhizaModule<unknown, unknown>
  validConfig?: unknown
  invalidConfig?: unknown
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
    ...configSchemaFailures(harness.module.configSchema, harness.validConfig, harness.invalidConfig),
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

  if (typeof instance.health === 'function') {
    try {
      const health = await instance.health()
      if (typeof health !== 'object' || health === null) {
        failures.push(`health() returned ${String(health)}, expected a HealthStatus`)
      } else {
        if (!HEALTH_STATES.includes(health.state)) {
          failures.push(
            `health() reported state '${String(health.state)}', expected one of ${HEALTH_STATES.join(', ')}`,
          )
        }
        if (!(health.checkedAt instanceof Date) || Number.isNaN(health.checkedAt.getTime())) {
          failures.push('health() returned no valid checkedAt date')
        }
      }
    } catch (e) {
      // health() reporting a problem is its job; throwing is not. The core calls it
      // on a schedule and a throw would surface as an unhandled rejection.
      failures.push(`health() threw instead of reporting a degraded state: ${(e as Error).message}`)
    }
  }

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
