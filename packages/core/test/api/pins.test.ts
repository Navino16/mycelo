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

// The other half of the refusal namespace: `defineConfig`'s mapping table lives in septum, and
// the join between it and `common` was verified by hand during review — which is not a pin.
const SEPTUM_CONFIG = readFileSync(
  resolve(import.meta.dirname, '../../../septum/src/config.ts'), 'utf8',
)

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

  // Three times the size of `api.*`, added by phase 9.6A and extended by nothing. Its two halves
  // live in two packages: core's src names some as literals, septum's MAPPED table names the rest,
  // and a typo in either compiles, passes its own unit test, and shows an operator a dotted key.
  it('uses every common.refusal.* key, and declares every one it uses in both locales', () => {
    const common = loadCoreCatalogs().get('common')
    const en = [...(common?.get('en')?.keys() ?? [])].filter((k) => k.startsWith('refusal.'))
    const fr = [...(common?.get('fr')?.keys() ?? [])].filter((k) => k.startsWith('refusal.'))
    const mapped = matches(SEPTUM_CONFIG, /key: '(refusal\.[A-Za-z0-9.]+)'/g)
    // §2.3 builds two keys as `${mapped.key}Exclusive`, which no literal scan can see. They are
    // derived from the catalogue and each one's base must be a MAPPED key, so the concatenation
    // is pinned from both ends instead of reported as an orphan.
    const exclusive = en.filter((k) => k.endsWith('Exclusive')).sort()
    const used = new Set([
      ...matches(ALL_SOURCE, /'(refusal\.[A-Za-z0-9.]+)'/g), ...mapped, ...exclusive,
    ])
    // Anchors: a regex or a loader that stopped finding anything would pass every check below.
    expect(en.length).toBeGreaterThan(25)
    expect(mapped).toHaveLength(7)
    expect(exclusive).toEqual(['refusal.config.tooBigExclusive', 'refusal.config.tooSmallExclusive'])
    expect(exclusive.filter((k) => !mapped.includes(k.slice(0, -'Exclusive'.length)))).toEqual([])
    // A key nothing names is dead weight the next reader trusts; a name with no key renders raw.
    expect(en.filter((key) => !used.has(key))).toEqual([])
    expect([...used].filter((key) => !en.includes(key))).toEqual([])
    expect([...used].filter((key) => !fr.includes(key))).toEqual([])
  })

  it('maps every RefusalCode a route can raise, so none falls through to a 500', () => {
    const union = /export type RefusalCode =([\s\S]*?)\n\n/.exec(read('authorization/refusal.ts'))?.[1] ?? ''
    const codes = matches(union, /'([a-z-]+)'/g)
    expect(codes).toHaveLength(9)
    const mappers = read('api/routes/roles.ts') + read('api/routes/people.ts')
    // The two plugin codes reach no route today: requireInstalled refuses before setEnabled or
    // redactSecrets can raise one, and no route calls writeDeclaredSetting — the settings route
    // runs undeclaredKeys itself. The exemption is unconditional, so it records that fact rather
    // than enforcing it.
    const unreachable = ['plugin-not-installed', 'setting-undeclared']
    expect(codes.filter((code) => unreachable.includes(code))).toEqual(unreachable)
    expect(
      codes.filter((code) => !unreachable.includes(code) && !mappers.includes(`isRefusal(e, '${code}')`)),
    ).toEqual([])
  })

  it('answers with exactly the error codes spec §9 lists', () => {
    const fromErrors = matches(read('api/errors.ts'), /new ApiError\(\d+, '([a-z-]+)'/g)
    const handler = read('api/server.ts').split('\n').filter((line) => /^\s*code:/.test(line)).join('\n')
    const fromHandler = matches(handler, /'([a-z-]+)'/g)
    // Nine constructors, eight codes: the three `common`-domain refusal builders reuse
    // validation, not-found and conflict rather than inventing a code of their own.
    expect(fromErrors).toHaveLength(9)
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

  // Its absence would make the critical banner render nothing, silently. Anchored on the
  // declaration line, not the word: a comment line begins with `*` or `/`, so it cannot match,
  // and both files already name the field in prose.
  it('declares enforcingBlocked on both sides', () => {
    const declaration = /^\s*enforcingBlocked: readonly string\[\]/m
    expect(read('supervision/health.ts')).toMatch(declaration)
    expect(uiTypes).toMatch(declaration)
  })
})
