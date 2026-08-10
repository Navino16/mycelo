import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export interface SporeLocation {
  /** Directory name on disk. Not the manifest name: they may disagree. */
  directory: string
  path: string
  manifestPath: string
}

/** Every immediate subdirectory holding a spore.yaml. Anything else is ignored. */
export function discover(sporesDir: string): SporeLocation[] {
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
}
