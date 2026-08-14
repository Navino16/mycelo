import { Database } from 'bun:sqlite'
import { beforeEach, describe, expect, it } from 'bun:test'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import type { Db } from '../../src/persistence/db.js'
import { migrateDatabase } from '../../src/persistence/db.js'
import { conversation, principal } from '../../src/persistence/schema.js'
import {
  canonicalLocale, localeForTarget, resolveLocale, setConversationLocale, setPrincipalLocale,
} from '../../src/i18n/locale.js'

let db: Db
beforeEach(() => {
  db = drizzle(new Database(':memory:')) as unknown as Db
  migrateDatabase(db)
  db.insert(principal).values({ id: 'p1', createdAt: new Date() }).run()
  db.insert(conversation).values({
    channel: 'console', conversationId: 'weekend', kind: 'group',
    firstSeenAt: new Date(), lastMessageAt: new Date(),
  }).run()
  db.insert(conversation).values({
    channel: 'console', conversationId: 'stdin', kind: 'dm',
    firstSeenAt: new Date(), lastMessageAt: new Date(),
  }).run()
})

describe('canonicalLocale', () => {
  it('canonicalises case and region', () => {
    expect(canonicalLocale('fr-fr')).toBe('fr-FR')
    expect(canonicalLocale('RU')).toBe('ru')
  })

  it('throws a message naming the tag, not a bare RangeError', () => {
    expect(() => canonicalLocale('not a locale')).toThrow(/not a locale/)
  })

  it('accepts a well-formed tag nobody has a catalogue for', () => {
    // Measured: Intl.getCanonicalLocales validates syntax, not existence. Refusing an
    // unavailable locale is locale.manage's job, not this function's.
    expect(canonicalLocale('zz')).toBe('zz')
  })
})

describe('resolveLocale', () => {
  it('falls back to the given default when neither carries a choice', () => {
    expect(resolveLocale(db, 'console', 'stdin', 'p1', 'en')).toBe('en')
  })

  it("uses the principal's choice in a conversation that has none", () => {
    setPrincipalLocale(db, 'p1', 'fr')
    expect(resolveLocale(db, 'console', 'stdin', 'p1', 'en')).toBe('fr')
  })

  it("lets the conversation win over the principal, because a group reply is read by everyone", () => {
    setPrincipalLocale(db, 'p1', 'fr')
    setConversationLocale(db, 'console', 'weekend', 'ru')
    expect(resolveLocale(db, 'console', 'weekend', 'p1', 'en')).toBe('ru')
    // The same principal, one conversation away, still reads French: a resolver that
    // returned the conversation's locale unconditionally would pass the line above.
    expect(resolveLocale(db, 'console', 'stdin', 'p1', 'en')).toBe('fr')
  })

  it('falls back for a conversation nobody has ever seen', () => {
    expect(resolveLocale(db, 'console', 'absent', 'p1', 'en')).toBe('en')
  })

  it('falls back for a principal that does not exist', () => {
    expect(resolveLocale(db, 'console', 'stdin', 'ghost', 'en')).toBe('en')
  })
})

describe('localeForTarget', () => {
  it("answers the conversation's locale, never a principal's", () => {
    setPrincipalLocale(db, 'p1', 'fr')
    setConversationLocale(db, 'console', 'weekend', 'ru')
    expect(localeForTarget(db, { channel: 'console', conversationId: 'weekend' }, 'en')).toBe('ru')
    expect(localeForTarget(db, { channel: 'console', conversationId: 'stdin' }, 'en')).toBe('en')
  })
})

describe('the writers', () => {
  it('canonicalises what it stores', () => {
    setPrincipalLocale(db, 'p1', 'fr-fr')
    expect(resolveLocale(db, 'console', 'stdin', 'p1', 'en')).toBe('fr-FR')
  })

  it('rejects an unknown principal', () => {
    expect(() => setPrincipalLocale(db, 'ghost', 'fr')).toThrow(/ghost/)
  })

  it('rejects a conversation the bot has never seen', () => {
    // The read/write pair lesson of phase 5.5: a writer that accepted a typo'd id would
    // store a locale nothing ever reads, and report success.
    expect(() => setConversationLocale(db, 'console', 'typo', 'fr')).toThrow(/typo/)
  })

  it('rejects an invalid tag on both writers', () => {
    expect(() => setPrincipalLocale(db, 'p1', 'not a locale')).toThrow(/not a locale/)
    expect(() => setConversationLocale(db, 'console', 'weekend', 'not a locale')).toThrow(/not a locale/)
  })

  it('replaces a choice rather than accumulating one', () => {
    setPrincipalLocale(db, 'p1', 'fr')
    setPrincipalLocale(db, 'p1', 'ru')
    expect(resolveLocale(db, 'console', 'stdin', 'p1', 'en')).toBe('ru')
  })
})
