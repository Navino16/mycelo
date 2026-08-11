import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { SporeModule } from '@mycelo/septum'
import type { ReadManifest } from './manifest.js'

const CODE_ENTRIES = ['src/index.ts', 'index.ts', 'dist/index.js', 'index.js']

function entryPoint(sporePath: string): string | null {
  for (const candidate of CODE_ENTRIES) {
    const file = join(sporePath, candidate)
    if (existsSync(file)) return file
  }
  return null
}

/** True when nothing in the manifest can reach a module. */
function needsNoModule(manifest: ReadManifest['manifest']): boolean {
  return manifest.kind === 'enzyme' && manifest.commands.every((c) => c.respond !== undefined)
}

/**
 * Imports a spore's module, or returns null when the spore ships none. Bun compiles
 * TypeScript directly, so a `.ts` entry and `.js`-specifier imports between spore files
 * both resolve — what the `local` driver relies on.
 */
export async function loadModule(read: ReadManifest): Promise<SporeModule<unknown, unknown> | null> {
  const { location, manifest } = read
  const entry = entryPoint(location.path)
  if (entry === null) {
    if (needsNoModule(manifest)) return null
    throw new Error(`no entry point: expected one of ${CODE_ENTRIES.join(', ')}`)
  }

  const imported: unknown = await import(pathToFileURL(entry).href)
  const module = (imported as { default?: unknown }).default
  // Duck-typed, never instanceof: a spore is bundled with its own copy of everything.
  if (typeof module !== 'object' || module === null || typeof (module as SporeModule<unknown, unknown>).create !== 'function') {
    throw new Error(`${entry} has no default export with a create()`)
  }
  return module as SporeModule<unknown, unknown>
}
