import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { SporeModule } from '@mycelo/septum'
import { DECLARATIVE_ENTRY, hasDeclarativeEntry, loadDeclarative } from '../enzyme/declarative.js'
import type { ReadManifest } from './manifest.js'

const CODE_ENTRIES = ['src/index.ts', 'index.ts', 'dist/index.js', 'index.js']

function entryPoint(sporePath: string): string | null {
  for (const candidate of CODE_ENTRIES) {
    const file = join(sporePath, candidate)
    if (existsSync(file)) return file
  }
  return null
}

/**
 * Imports a spore's module. A `.ts` entry loads through Node's type-stripping loader,
 * which is what the `local` driver relies on and why the erasable-syntax rule exists.
 */
export async function loadModule(read: ReadManifest): Promise<SporeModule<unknown, unknown>> {
  const { location, manifest } = read

  if (manifest.kind === 'enzyme' && hasDeclarativeEntry(location.path)) {
    return loadDeclarative(location.path, manifest.commands.map((c) => c.name))
  }

  const entry = entryPoint(location.path)
  if (entry === null) {
    throw new Error(`no entry point: expected one of ${[...CODE_ENTRIES, DECLARATIVE_ENTRY].join(', ')}`)
  }

  const imported: unknown = await import(pathToFileURL(entry).href)
  const module = (imported as { default?: unknown }).default
  // Duck-typed, never instanceof: a spore is bundled with its own copy of everything.
  if (typeof module !== 'object' || module === null || typeof (module as SporeModule<unknown, unknown>).create !== 'function') {
    throw new Error(`${entry} has no default export with a create()`)
  }
  return module as SporeModule<unknown, unknown>
}
