import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import { parseManifest } from '@mycelo/septum'
import type { Manifest } from '@mycelo/septum'
import type { SporeLocation } from './discover.js'

export interface ReadManifest {
  location: SporeLocation
  manifest: Manifest
}

/** A spore that could not be read. Dormant, never fatal (spec §8). */
export interface ManifestFailure {
  location: SporeLocation
  reason: string
}

// ManifestError.message alone is Zod's generic text ("Invalid input: expected string,
// received undefined"), identical for any missing string field, so .path is what lets
// an author find the offending line. Duck-typed, never instanceof, matching load.ts
// and shape.ts: nothing here should assume this error came from this core's own copy.
export function manifestFailureReason(e: unknown): string {
  const path = (e as { path?: unknown }).path
  return typeof path === 'string' ? `invalid manifest at '${path}': ${(e as Error).message}` : (e as Error).message
}

export function readManifest(location: SporeLocation): ReadManifest | ManifestFailure {
  let raw: unknown
  try {
    raw = parseYaml(readFileSync(location.manifestPath, 'utf8'))
  } catch (e) {
    return { location, reason: `cannot read spore.yaml: ${(e as Error).message}` }
  }
  try {
    return { location, manifest: parseManifest(raw) }
  } catch (e) {
    return { location, reason: manifestFailureReason(e) }
  }
}

export function isFailure(r: ReadManifest | ManifestFailure): r is ManifestFailure {
  return 'reason' in r
}
