import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import { parseManifest } from '@mycelo/septum'
import type { Manifest, TranslatableRef } from '@mycelo/septum'
import type { SporeLocation } from './discover.js'
import { fault } from './fault.js'
import type { Fault } from './fault.js'

export interface ReadManifest {
  location: SporeLocation
  manifest: Manifest
}

/** A spore that could not be read. Dormant, never fatal (spec §8). */
export interface ManifestFailure {
  location: SporeLocation
  reason: string
  /** design §2.2. Renders at the request's locale on /api/plugins, at the default in the log. */
  refusal: TranslatableRef
  /**
   * True only when the unvalidated YAML literally declares an enforcing inhibitor, so
   * design §7 can still refuse all traffic for one whose manifest never parsed.
   */
  enforcingInhibitor: boolean
}

// Nothing here validated, so nothing here is trusted: two exact literals, no coercion
// and no defaulting. Anything else leaves the spore merely dormant.
function declaresEnforcingInhibitor(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false
  const { kind, enforcing } = raw as Record<string, unknown>
  return kind === 'inhibitor' && enforcing === true
}

// ManifestError.message alone is Zod's generic text ("Invalid input: expected string,
// received undefined"), identical for any missing string field, so .path is what lets
// an author find the offending line. Duck-typed, never instanceof, matching load.ts
// and shape.ts: nothing here should assume this error came from this core's own copy.
export function manifestFailureFault(e: unknown): Fault {
  const path = (e as { path?: unknown }).path
  const detail = (e as Error).message
  return typeof path === 'string'
    ? fault(`invalid manifest at '${path}': ${detail}`, 'refusal.germination.invalidManifest', { path, detail })
    : fault(detail, 'refusal.germination.invalidManifestNoPath', { detail })
}

export function manifestFailureReason(e: unknown): string {
  return manifestFailureFault(e).message
}

export function readManifest(location: SporeLocation): ReadManifest | ManifestFailure {
  let raw: unknown
  try {
    raw = parseYaml(readFileSync(location.manifestPath, 'utf8'))
  } catch (e) {
    // Unreadable YAML yields no fields at all, so an enforcing inhibitor cannot be
    // recognised here — the only case design §7 cannot cover.
    const detail = (e as Error).message
    const f = fault(
      `cannot read spore.yaml: ${detail}`,
      'refusal.plugin.unreadableManifest',
      { plugin: location.directory, detail },
    )
    return { location, reason: f.message, refusal: f.refusal, enforcingInhibitor: false }
  }
  try {
    return { location, manifest: parseManifest(raw) }
  } catch (e) {
    const f = manifestFailureFault(e)
    return {
      location, reason: f.message, refusal: f.refusal,
      enforcingInhibitor: declaresEnforcingInhibitor(raw),
    }
  }
}

export function isFailure(r: ReadManifest | ManifestFailure): r is ManifestFailure {
  return 'reason' in r
}
