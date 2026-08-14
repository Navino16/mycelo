import { describe, expect, it } from 'bun:test'
import { recordInstall } from '../../src/config/store.js'
import { migrateDatabase, openDatabase } from '../../src/persistence/db.js'
import {
  allInhibitorChannels, clearContextRule, contextRuleFor, inhibitorChannels, listContextRules,
  setContextRule, setInhibitorChannels,
} from '../../src/restrictions/rules.js'

function fresh() {
  const persistence = openDatabase(':memory:')
  migrateDatabase(persistence.db)
  return persistence
}

describe('context rules', () => {
  it('stores, lists, replaces and clears a rule', () => {
    const { db, close } = fresh()
    setContextRule(db, 'admin.*', 'dm')
    expect(listContextRules(db)).toEqual([{ pattern: 'admin.*', where: 'dm' }])
    setContextRule(db, 'admin.*', 'group')
    expect(listContextRules(db)).toEqual([{ pattern: 'admin.*', where: 'group' }])
    clearContextRule(db, 'admin.*')
    clearContextRule(db, 'admin.*')
    const after = listContextRules(db)
    close()
    expect(after).toEqual([])
  })

  it('rejects a pattern outside the three known forms', () => {
    const { db, close } = fresh()
    expect(() => setContextRule(db, 'admin.*.x', 'dm')).toThrow("pattern 'admin.*.x' is not one of")
    expect(() => setContextRule(db, '', 'dm')).toThrow()
    expect(() => setContextRule(db, 'Admin.*', 'dm')).toThrow()
    close()
  })

  it('applies the most specific rule when several match', () => {
    const { db, close } = fresh()
    setContextRule(db, '*', 'group')
    setContextRule(db, 'admin.*', 'dm')
    setContextRule(db, 'admin.whoami', 'group')
    expect(contextRuleFor(db, 'admin.whoami')).toBe('group')
    expect(contextRuleFor(db, 'admin.plugins')).toBe('dm')
    expect(contextRuleFor(db, 'media.movies')).toBe('group')
    clearContextRule(db, '*')
    const unmatched = contextRuleFor(db, 'media.movies')
    close()
    expect(unmatched).toBeNull()
  })
})

describe('inhibitor channels', () => {
  it('replaces the list wholesale and reads an empty list as every channel', () => {
    const { db, close } = fresh()
    recordInstall(db, 'gate', 'inhibitor')
    expect(inhibitorChannels(db, 'gate')).toEqual([])
    setInhibitorChannels(db, 'gate', ['console', 'signal'])
    expect(inhibitorChannels(db, 'gate')).toEqual(['console', 'signal'])
    setInhibitorChannels(db, 'gate', ['signal'])
    expect(inhibitorChannels(db, 'gate')).toEqual(['signal'])
    setInhibitorChannels(db, 'gate', [])
    const restored = inhibitorChannels(db, 'gate')
    close()
    expect(restored).toEqual([])
  })

  it('rejects a plugin that is not installed', () => {
    const { db, close } = fresh()
    expect(() => setInhibitorChannels(db, 'ghost', ['console'])).toThrow("plugin 'ghost' is not installed")
    close()
  })

  it('reads every confinement in one map', () => {
    const { db, close } = fresh()
    recordInstall(db, 'gate', 'inhibitor')
    recordInstall(db, 'other', 'inhibitor')
    setInhibitorChannels(db, 'gate', ['console'])
    const map = allInhibitorChannels(db)
    close()
    expect(map.get('gate')).toEqual(['console'])
    expect(map.get('other')).toBeUndefined()
  })
})
