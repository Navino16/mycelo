import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { BootstrapError } from '../config.js'

export interface SporeLocation {
  /** Directory name on disk. Not the manifest name: they may disagree. */
  directory: string
  path: string
  manifestPath: string
}

/** Every immediate subdirectory holding a spore.yaml, root by root, each root sorted on its own. */
export function discover(sporesDirs: readonly string[]): SporeLocation[] {
  return sporesDirs.flatMap((sporesDir) => {
    if (!existsSync(sporesDir)) return []
    return readdirSync(sporesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => ({
        directory: e.name,
        path: join(sporesDir, e.name),
        manifestPath: join(sporesDir, e.name, 'spore.yaml'),
      }))
      .filter((l) => existsSync(l.manifestPath))
      .sort((a, b) => a.directory.localeCompare(b.directory))
  })
}

/** design §4.2: refused once at boot, never resolved by precedence. */
export function assertNoCollisions(sporesDirs: readonly string[]): void {
  const seen = new Map<string, string>()
  for (const location of discover(sporesDirs)) {
    const first = seen.get(location.directory)
    if (first !== undefined) {
      throw new BootstrapError(
        `spore directory '${location.directory}' exists in both '${first}' and '${location.path}'`,
        'spores',
      )
    }
    seen.set(location.directory, location.path)
  }
}
