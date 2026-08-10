import { sourceErasabilityFailures } from './erasability.js'
import { parseManifest } from '../manifest.js'
import type { HyphaModule } from '../hypha.js'

export interface HyphaHarness {
  name: string
  /** The plugin's spore.yaml, already parsed from YAML into a plain object. */
  manifest: unknown
  /**
   * The plugin's entry module. Typed `unknown` rather than `never` for the config:
   * a `ConfigSchema<never>` would require `safeParse` to yield `data: never`, which
   * no real schema satisfies — so no author with a config schema could build a
   * harness at all, and the configSchema checks below would be unreachable.
   */
  module: HyphaModule<unknown>
  /** Absolute paths to the plugin's own source files. See sourceErasabilityFailures. */
  sourcePaths?: readonly string[]
  /** A config the schema must accept. Omit to skip that half of the check. */
  validConfig?: unknown
  /** A config the schema must reject. Omit only if every input is valid. */
  invalidConfig?: unknown
}

/**
 * Runs every contract check and returns the failures, so the same logic can be
 * used inside a describe() block or asserted directly in a test.
 */
export async function hyphaChecks(harness: HyphaHarness): Promise<string[]> {
  const failures: string[] = [...(await sourceErasabilityFailures(harness.sourcePaths))]

  let manifest
  try {
    manifest = parseManifest(harness.manifest)
  } catch (e) {
    return [...failures, `manifest does not parse: ${(e as Error).message}`]
  }

  if (manifest.kind !== 'hypha') {
    failures.push(`manifest kind is '${manifest.kind}', expected 'hypha'`)
    return failures
  }

  // Each sub-check is gated on its own input, not on validConfig: an author who
  // only wants to assert that the schema rejects bad input should not have to
  // invent a valid config, and safeParse(undefined) would fail against any
  // z.object(), reporting a conformant plugin as broken.
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
  for (const method of ['start', 'stop', 'send'] as const) {
    if (typeof instance[method] !== 'function') {
      failures.push(`create() returned no ${method}()`)
    }
  }

  const declaresMembership = manifest.capabilities.includes('group_membership')
  const implementsMembership = typeof instance.listGroupMembers === 'function'
  if (declaresMembership && !implementsMembership) {
    failures.push('manifest declares group_membership but there is no listGroupMembers()')
  }
  if (!declaresMembership && implementsMembership) {
    failures.push('listGroupMembers() exists but the manifest does not declare group_membership')
  }

  // stop() must be safe after a start() that never ran, because the core calls
  // stop() during shutdown regardless of how germination went (spec §8). Guarded:
  // a missing stop() is already reported above, and calling it anyway would add a
  // second failure blaming a shutdown path that does not exist.
  //
  // start() is not called here, unlike in the enzyme and inhibitor kits. A hypha's
  // start() opens the channel connection itself rather than through a context the
  // author stubs, so invoking it would make the conformance suite dial Signal.
  if (typeof instance.stop === 'function') {
    try {
      await instance.stop()
    } catch (e) {
      failures.push(`stop() throws when start() never ran: ${(e as Error).message}`)
    }
  }

  return failures
}
