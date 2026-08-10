import { existsSync } from 'node:fs'
import type { Enzyme, Hypha, Logger } from '@mycelo/septum'
import { discover } from './discover.js'
import { loadModule } from './load.js'
import { isFailure, readManifest } from './manifest.js'
import { buildRoutes } from './registry.js'
import type { Dormant, GerminatedEnzyme, GerminatedHypha, Registry } from './registry.js'

const REQUIRED_METHODS = {
  hypha: ['start', 'stop', 'send'],
  enzyme: ['handle'],
} as const

/**
 * Duck-typed, never instanceof: a spore is bundled with its own copy of everything.
 * Without this the cast below would register an instance nothing has checked, and the
 * failure would surface on the first message instead of at germination.
 */
function shapeError(instance: unknown, kind: 'hypha' | 'enzyme'): string | null {
  if (typeof instance !== 'object' || instance === null) {
    return `create() returned ${String(instance)}, expected an object`
  }
  const missing = REQUIRED_METHODS[kind].filter(
    (m) => typeof (instance as Record<string, unknown>)[m] !== 'function',
  )
  return missing.length > 0 ? `create() returned no ${missing.join(', ')}` : null
}

/**
 * Walks the spores directory. A spore that fails goes dormant with a reason; only a
 * command collision halts the whole phase (spec §8).
 */
export async function germinate(sporesDir: string, logger: Logger): Promise<Registry> {
  // A missing directory and a missing config file both resolve quietly to defaults
  // (spec-compliant on their own), but their combination — run from the wrong cwd —
  // produced "germinated 0 spores" and exit 0 with no word said. Not a crash, but not
  // legible either.
  if (!existsSync(sporesDir)) {
    logger.warn(`spores directory does not exist: '${sporesDir}' — nothing will germinate`)
  }

  const hyphae: GerminatedHypha[] = []
  const enzymes: GerminatedEnzyme[] = []
  const dormant: Dormant[] = []

  for (const location of discover(sporesDir)) {
    const read = readManifest(location)
    if (isFailure(read)) {
      dormant.push({ name: location.directory, reason: read.reason })
      continue
    }
    const { manifest } = read
    // Anastomosis resolution is phase 3. Germinating a spore whose dependencies
    // nothing resolves would make ctx.has() lie about what is available.
    if (manifest.requires !== undefined && manifest.requires.length > 0) {
      dormant.push({ name: manifest.name, reason: 'requires other spores: anastomoses arrive in phase 3' })
      continue
    }
    if (manifest.kind !== 'hypha' && manifest.kind !== 'enzyme') {
      dormant.push({ name: manifest.name, reason: `kind '${manifest.kind}' is not routed until phase 3` })
      continue
    }
    try {
      const module = await loadModule(read)
      const instance: unknown = module.create()
      const problem = shapeError(instance, manifest.kind)
      if (problem !== null) {
        dormant.push({ name: manifest.name, reason: problem })
        continue
      }
      if (manifest.kind === 'hypha') {
        hyphae.push({ name: manifest.name, manifest, instance: instance as Hypha })
      } else {
        enzymes.push({ name: manifest.name, manifest, instance: instance as Enzyme })
      }
    } catch (e) {
      dormant.push({ name: manifest.name, reason: (e as Error).message })
    }
  }

  for (const d of dormant) logger.warn(`spore '${d.name}' is dormant`, { reason: d.reason })
  if (hyphae.length === 0 && enzymes.length === 0) {
    logger.warn('germination produced zero spores: no channel and no command will ever answer')
  }
  return { hyphae, enzymes, dormant, routes: buildRoutes(enzymes) }
}
