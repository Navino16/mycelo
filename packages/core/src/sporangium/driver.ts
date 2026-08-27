import type { SporeKind } from '@mycelo/septum'

// Mirrors septum's manifest nameSchema (packages/septum/src/manifest.ts), which is not exported.
// An offer name becomes a directory name under the managed root, so it is validated wherever
// it crosses into the file system as well as where a tag is parsed.
export const SPORE_NAME = /^[a-z][a-z0-9-]*$/

// Bun.semver.satisfies tolerates trailing garbage and is strictly looser than this regex on
// every input that matches it — this is the whole guard on the strain's shape, and the strain
// is written to disk as part of the install record.
export const STRAIN_SHAPE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/

export interface SporeOffer {
  /** The manifest name: what `inoculate` takes and what the tag carries. */
  name: string
  /** Newest published strain. */
  strain: string
}

export interface SporeDetail {
  name: string
  kind: SporeKind
  description: string
  /** The range the spore declares, so the UI can warn before an install is attempted. */
  septum: string
}

export interface SporeBundle {
  /** The tarball's bytes, unverified. `inoculate` validates before anything is written. */
  tarball: Uint8Array
  strain: string
}

export interface SporangiumDriver {
  /** Every spore this source offers, with its newest strain. One request (design §8). */
  list: () => Promise<readonly SporeOffer[]>
  /** Newest first. */
  strains: (name: string) => Promise<readonly string[]>
  /** Kind, description and declared range, read lazily: one request per spore opened. */
  detail: (name: string, strain: string) => Promise<SporeDetail>
  fetch: (name: string, strain: string) => Promise<SporeBundle>
}
