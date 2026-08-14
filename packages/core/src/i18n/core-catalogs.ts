import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { StartupError } from '../identity/bootstrap.js'
import type { Catalogs } from './catalog.js'
import { loadCatalogs } from './catalog.js'

// Resolved from this module rather than from cwd: the core is started from
// packages/core/src/index.ts by Bun and from packages/core/dist/index.js by Node, and
// `../../translations` reaches the same directory from either.
export const CORE_TRANSLATIONS_DIR = join(import.meta.dirname, '../../translations')

/** The two domains the runtime owns; asserted present at boot by assertCoreCatalogs. */
export const CORE_OWNED_DOMAINS = ['core', 'common'] as const

/**
 * The runtime's own domains. Every subdirectory is one domain, named by the directory.
 * A missing directory returns none at all, like loadCatalogs — assertCoreCatalogs is what
 * turns that into a clean startup failure, rather than this throwing a raw ENOENT.
 */
export function loadCoreCatalogs(): Catalogs {
  const catalogs = new Map<string, ReturnType<typeof loadCatalogs>>()
  if (!existsSync(CORE_TRANSLATIONS_DIR)) return catalogs
  for (const entry of readdirSync(CORE_TRANSLATIONS_DIR, { withFileTypes: true })) {
    if (entry.isDirectory()) catalogs.set(entry.name, loadCatalogs(join(CORE_TRANSLATIONS_DIR, entry.name)))
  }
  return catalogs
}

/**
 * Fails startup rather than answering every refusal with a raw catalogue key. mycelium.ts's
 * availableLocales() check is not enough on its own: it unions every domain, so one plugin
 * shipping the default locale would mask the core's own translations being entirely absent.
 */
export function assertCoreCatalogs(catalogs: Catalogs, defaultLocale: string): void {
  for (const domain of CORE_OWNED_DOMAINS) {
    if (!(catalogs.get(domain)?.has(defaultLocale) ?? false)) {
      throw new StartupError(
        `the '${domain}' translation catalogue for the default locale '${defaultLocale}' is missing — `
        + `packages/core/translations/${domain}/${defaultLocale}.yaml must ship with the core`,
      )
    }
  }
}
