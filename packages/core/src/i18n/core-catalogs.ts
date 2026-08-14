import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Catalogs } from './catalog.js'
import { loadCatalogs } from './catalog.js'

// Resolved from this module rather than from cwd: the core is started from
// packages/core/src/index.ts by Bun and from packages/core/dist/index.js by Node, and
// `../../translations` reaches the same directory from either.
export const CORE_TRANSLATIONS_DIR = join(import.meta.dirname, '../../translations')

/** The runtime's own domains. Every subdirectory is one domain, named by the directory. */
export function loadCoreCatalogs(): Catalogs {
  const catalogs = new Map<string, ReturnType<typeof loadCatalogs>>()
  for (const entry of readdirSync(CORE_TRANSLATIONS_DIR, { withFileTypes: true })) {
    if (entry.isDirectory()) catalogs.set(entry.name, loadCatalogs(join(CORE_TRANSLATIONS_DIR, entry.name)))
  }
  return catalogs
}
