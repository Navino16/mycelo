import { describe, expect, it } from 'bun:test'
import type { RefusalCode } from '../src/authorization/refusal.js'
import type { RefusalKey } from '../src/i18n/refusal-keys.js'
import { StoreRefusal } from '../src/authorization/refusal.js'
import { loadCoreCatalogs } from '../src/i18n/core-catalogs.js'
import { joinOutcome, outcome, outcomeOf, refusalKeyOf } from '../src/mycelium-refusal.js'

/**
 * The map, spelled out independently of the implementation: `satisfies` makes a code added to
 * `RefusalCode` without an entry here fail to compile — and, against `RefusalKey`, an entry
 * naming a key the shipped catalogue does not carry. Comparing the values catches two codes'
 * keys swapped, which a "every key is distinct" assertion cannot see.
 */
const EXPECTED = {
  'role-unknown': 'refusal.role.notFound',
  'role-exists': 'refusal.role.exists',
  'role-builtin': 'refusal.role.builtin',
  'role-is-default': 'refusal.role.isDefault',
  'role-name-empty': 'refusal.role.nameEmpty',
  'pattern-duplicate': 'refusal.role.patternDuplicate',
  'principal-unknown': 'refusal.person.notFound',
  'plugin-not-installed': 'refusal.plugin.notInstalled',
  'setting-undeclared': 'refusal.plugin.settingUndeclared',
} as const satisfies Record<RefusalCode, RefusalKey>

const CODES = Object.keys(EXPECTED) as RefusalCode[]

describe('refusalKeyOf', () => {
  it('maps every RefusalCode to its own key, and the map is total', () => {
    // The plural case AND the totality: a map collapsed to one entry passes a single-code assertion.
    expect(CODES.length).toBeGreaterThan(1)
    for (const code of CODES) expect(refusalKeyOf(code)).toBe(EXPECTED[code])
    const keys = CODES.map(refusalKeyOf)
    expect(new Set(keys).size).toBe(CODES.length)
    expect(keys.every((k) => k.startsWith('refusal.'))).toBe(true)
  })

  // The fourth of the four sites a new code moves: the union, KEYS, the catalogue and the route.
  // Without this a code fires and the spore renders the dotted key itself.
  it('names a key the common catalogue actually carries, in every locale it ships', () => {
    const common = loadCoreCatalogs().get('common')
    expect([...(common?.keys() ?? [])].sort()).toEqual(['en', 'fr'])
    for (const [locale, messages] of common ?? []) {
      const missing = CODES.map(refusalKeyOf).filter((key) => !messages.has(key))
      expect({ locale, missing }).toEqual({ locale, missing: [] })
    }
  })
})

describe('outcome', () => {
  it('answers success for work that returns', async () => {
    expect(await outcome(() => { /* nothing to do */ })).toEqual({ ok: true })
  })

  it("turns a StoreRefusal into a refusal, in common, carrying the thrower's params", async () => {
    const r = await outcome(() => {
      throw new StoreRefusal('role-unknown', "role 'ops' does not exist", { role: 'ops' })
    })
    expect(r).toEqual({
      ok: false,
      refusal: { domain: 'common', key: 'refusal.role.notFound', params: { role: 'ops' } },
    })
  })

  it('omits params entirely for a refusal that carries none', async () => {
    const r = await outcome(() => {
      throw new StoreRefusal('role-name-empty', 'a role name cannot be empty')
    })
    expect(r).toEqual({ ok: false, refusal: { domain: 'common', key: 'refusal.role.nameEmpty' } })
  })

  it('propagates anything else, because a SQLite failure is not something an operator can fix', async () => {
    // Swallowing this would report a bug as a refusal, and the operator would go looking for a
    // role that was never the problem.
    let thrown: unknown
    try {
      await outcome(() => { throw new TypeError('a real bug') })
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(TypeError)
    expect((thrown as Error).message).toBe('a real bug')
  })
})

describe('outcomeOf', () => {
  it('carries the value on success', async () => {
    expect(await outcomeOf(() => ({ url: 'http://x' }))).toEqual({ ok: true, value: { url: 'http://x' } })
  })

  it('answers a refusal with no value at all, so an unnarrowed read cannot see undefined', async () => {
    const r = await outcomeOf(() => {
      throw new StoreRefusal('plugin-not-installed', "plugin 'ghost' is not installed", { plugin: 'ghost' })
    })
    expect(r).toEqual({
      ok: false,
      refusal: { domain: 'common', key: 'refusal.plugin.notInstalled', params: { plugin: 'ghost' } },
    })
    expect('value' in r).toBe(false)
  })

  it('propagates a non-refusal', async () => {
    let thrown: unknown
    try {
      await outcomeOf(() => { throw new RangeError('a real bug') })
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(RangeError)
  })
})

describe('joinOutcome', () => {
  it('answers what the work answers, for work that already returns an Outcome', async () => {
    expect(await joinOutcome(() => Promise.resolve({ ok: true }))).toEqual({ ok: true })
  })

  it("turns a StoreRefusal thrown from under the work into a refusal", async () => {
    const r = await joinOutcome(() => {
      throw new StoreRefusal('plugin-not-installed', "plugin 'ghost' is not installed", { plugin: 'ghost' })
    })
    expect(r).toEqual({
      ok: false,
      refusal: { domain: 'common', key: 'refusal.plugin.notInstalled', params: { plugin: 'ghost' } },
    })
  })

  it('propagates a non-refusal, rather than reporting a bug as success', async () => {
    let thrown: unknown
    try {
      await joinOutcome(() => { throw new Error('a real bug') })
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toBe('a real bug')
  })
})
