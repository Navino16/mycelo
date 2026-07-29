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
  /** A config the schema must accept. */
  /** Absolute paths to the plugin's own source files. See sourceErasabilityFailures. */
  sourcePaths?: readonly string[]
  validConfig: unknown
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
    return [`manifest does not parse: ${(e as Error).message}`]
  }

  if (manifest.kind !== 'hypha') {
    failures.push(`manifest kind is '${manifest.kind}', expected 'hypha'`)
    return failures
  }

  const schema = harness.module.configSchema
  if (schema !== undefined) {
    if (!schema.safeParse(harness.validConfig).success) {
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
  // stop() during shutdown regardless of how germination went (spec §8).
  try {
    await instance.stop()
  } catch (e) {
    failures.push(`stop() throws when start() never ran: ${(e as Error).message}`)
  }

  return failures
}
