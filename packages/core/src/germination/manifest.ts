import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import { ManifestError, parseManifest } from '@mycelo/septum'
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
    // ManifestError.message alone is Zod's generic text ("Invalid input: expected
    // string, received undefined"), identical for any missing string field. Naming
    // .path is what lets a plugin author find the actual offending line.
    const reason = e instanceof ManifestError
      ? `invalid manifest at '${e.path}': ${e.message}`
      : (e as Error).message
    return { location, reason }
  }
}

export function isFailure(r: ReadManifest | ManifestFailure): r is ManifestFailure {
  return 'reason' in r
}
