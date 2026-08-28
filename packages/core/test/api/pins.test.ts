import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { loadCoreCatalogs } from '../../src/i18n/core-catalogs.js'

const SRC = resolve(import.meta.dirname, '../../src')

function everySourceFile(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return everySourceFile(path)
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : []
  })
}

const SOURCES = everySourceFile(SRC).map((path) => readFileSync(path, 'utf8'))
const ALL_SOURCE = SOURCES.join('\n')

function read(relative: string): string {
  return readFileSync(join(SRC, relative), 'utf8')
}

function matches(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map((m) => m[1] ?? '')
}

// Three lists this phase leaves correct and pinned by nothing. The project already pins
// MYCELIUM_SCOPES against MOUNTABLE_SCOPES in three separate places for the same reason:
// each half stays right on its own while the pair drifts apart.
describe('the api lists nothing else pins', () => {
  it('uses every api.* catalogue key, and declares every one it uses in both locales', () => {
    const core = loadCoreCatalogs().get('core')
    const en = [...(core?.get('en')?.keys() ?? [])].filter((k) => k.startsWith('api.'))
    const fr = [...(core?.get('fr')?.keys() ?? [])].filter((k) => k.startsWith('api.'))
    const used = new Set(matches(ALL_SOURCE, /'(api\.[A-Za-z0-9]+)'/g))
    // Anchors: a regex or a loader that stops finding anything would pass every check below.
    expect(en.length).toBeGreaterThan(20)
    expect(used.size).toBeGreaterThan(20)
    // A key no throw site names is dead weight the next reader trusts.
    expect(en.filter((key) => !used.has(key))).toEqual([])
    // A throw site with no entry renders the raw key to the operator, in both directions.
    expect([...used].filter((key) => !en.includes(key))).toEqual([])
    expect([...used].filter((key) => !fr.includes(key))).toEqual([])
  })

  it('maps every RefusalCode in a route, so none falls through to a 500', () => {
    const union = /export type RefusalCode =([\s\S]*?)\n\n/.exec(read('authorization/refusal.ts'))?.[1] ?? ''
    const codes = matches(union, /'([a-z-]+)'/g)
    expect(codes).toHaveLength(7)
    const mappers = read('api/routes/roles.ts') + read('api/routes/people.ts')
    expect(codes.filter((code) => !mappers.includes(`isRefusal(e, '${code}')`))).toEqual([])
  })

  it('answers with exactly the error codes spec §9 lists', () => {
    const fromErrors = matches(read('api/errors.ts'), /new ApiError\(\d+, '([a-z-]+)'/g)
    const handler = read('api/server.ts').split('\n').filter((line) => /^\s*code:/.test(line)).join('\n')
    const fromHandler = matches(handler, /'([a-z-]+)'/g)
    expect(fromErrors).toHaveLength(6)
    expect(fromHandler).toHaveLength(3)
    expect([...new Set([...fromErrors, ...fromHandler])].sort()).toEqual([
      'conflict', 'degraded', 'internal', 'not-found',
      'rate-limited', 'setup-required', 'unauthenticated', 'validation',
    ])
  })
})

// The UI redeclares these shapes rather than importing them (spec §2), so nothing but this
// pins the two whose drift would be silent.
describe('the ui redeclares two shapes whose drift would be silent', () => {
  const uiTypes = readFileSync(
    join(import.meta.dirname, '..', '..', '..', 'ui', 'src', 'api', 'types.ts'), 'utf8',
  )

  // 'pending' arrived in 0.11.0. A UI missing it renders an enabled-not-yet-germinated
  // plugin as nothing at all, which is the defect that member exists to fix.
  it('carries every PluginDto state, including pending', () => {
    const core = matches(
      /state: ([^\n]*)\n/.exec(read('api/routes/plugins.ts'))?.[1] ?? '', /'([a-z]+)'/g,
    )
    const ui = matches(
      /export type PluginState =([^\n]*)\n/.exec(uiTypes)?.[1] ?? '', /'([a-z]+)'/g,
    )
    expect(core).toEqual(['germinated', 'dormant', 'disabled', 'pending', 'unknown'])
    expect(ui).toEqual(core)
  })

  // Its absence would make the critical banner render nothing, silently.
  it('carries enforcingBlocked', () => {
    expect(read('supervision/health.ts')).toContain('enforcingBlocked')
    expect(uiTypes).toContain('enforcingBlocked')
  })
})
