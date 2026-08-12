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
  /** A config the schema must accept. Omit to skip that half of the check. */
  validConfig?: unknown
  /** A config the schema must reject. Omit only if every input is valid. */
  invalidConfig?: unknown
  /**
   * A group id to call `listGroupMembers` with. Opt-in, because the kit never calls
   * `connect()` — a hypha needing its connection first would fail on a correct
   * implementation. Supply it when the method answers without one.
   */
  membershipGroupId?: string
}

/** Returns the failures, so the same logic serves a describe() block or a bare assertion. */
export async function hyphaChecks(harness: HyphaHarness): Promise<string[]> {
  const failures: string[] = []

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

  // Each sub-check is gated on its own input: safeParse(undefined) fails against
  // any z.object(), so an ungated check would punish an author who declares only
  // an invalidConfig.
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
  for (const method of ['connect', 'listen', 'stop', 'send'] as const) {
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
  // An array, never null: the core reads anything else as "membership unavailable", which
  // makes an enforcing inhibitor refuse every message on the channel.
  if (implementsMembership && harness.membershipGroupId !== undefined) {
    try {
      const members: unknown = await instance.listGroupMembers?.(harness.membershipGroupId)
      if (!Array.isArray(members)) {
        failures.push(`listGroupMembers() resolved ${members === null ? 'null' : typeof members}, expected an array`)
      }
    } catch (e) {
      failures.push(`listGroupMembers() threw: ${(e as Error).message}`)
    }
  }

  // stop() must be safe after a connect() that never ran: the core calls it during
  // shutdown regardless of how germination went (spec §8). Guarded, because a
  // missing stop() is already reported above.
  //
  // connect() is not called here, unlike in the enzyme and inhibitor kits: a hypha
  // opens its channel connection directly, not through a context the author stubs,
  // so calling it would make the conformance suite dial Signal.
  if (typeof instance.stop === 'function') {
    try {
      await instance.stop()
    } catch (e) {
      failures.push(`stop() throws when connect() never ran: ${(e as Error).message}`)
    }
  }

  return failures
}
