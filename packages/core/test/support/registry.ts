import type { Registry } from '../../src/germination/registry.js'

/** A germination that produced nothing: the shape a test builds on when only installs matter. */
export function emptyRegistry(): Registry {
  return {
    hyphae: [], rhizas: [], enzymes: [], inhibitors: [], dormant: [],
    routes: new Map(), order: [], brokenEnforcing: [], catalogs: new Map(),
  }
}
