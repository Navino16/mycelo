import { dirname, join } from 'node:path'

/**
 * The root the core owns: derived from the database's location, so data and spores move
 * together. A leaf module because config.ts derives it and inoculate.ts reaches config.ts
 * through germination/discover.ts.
 */
export function managedRoot(dbFile: string): string {
  return join(dirname(dbFile), 'spores')
}
