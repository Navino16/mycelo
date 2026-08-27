import type { SporeKind } from '@mycelo/septum'

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
