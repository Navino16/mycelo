import { describe, expect, test } from 'bun:test'
import {
  addSource, deleteSource, getSource, listSources, seedOfficialSource, sourceToken, TOKEN_MASK, updateSource,
  upsertLocalSource,
} from '../../src/sporangium/sources.js'
import { freshDb } from '../support/db.js'

describe('sources', () => {
  test('seeding writes exactly one official source, and is idempotent', () => {
    const { db } = freshDb()
    seedOfficialSource(db)
    seedOfficialSource(db)
    const official = listSources(db).filter((s) => s.official)
    expect(official).toHaveLength(1)
    expect(official[0]?.driver).toBe('github')
    expect(official[0]?.location).toContain('mycelo-spores')
  })

  test('seeding still writes the official source when a third-party source exists first', () => {
    const { db } = freshDb()
    addSource(db, { label: 'third-party', driver: 'github', location: 'https://example/third' })
    seedOfficialSource(db)
    const official = listSources(db).filter((s) => s.official)
    expect(official).toHaveLength(1)
  })

  test('the official source cannot be deleted, only disabled', () => {
    const { db } = freshDb()
    seedOfficialSource(db)
    const id = listSources(db)[0]!.id
    expect(deleteSource(db, id)).toBe(false)
    expect(getSource(db, id)).not.toBeNull()
    expect(updateSource(db, id, { enabled: false })?.enabled).toBe(false)
  })

  test('a third-party source can be deleted, so the refusal is about official and not about delete', () => {
    const { db } = freshDb()
    const added = addSource(db, { label: 'x', driver: 'github', location: 'https://example/x' })
    expect(deleteSource(db, added.id)).toBe(true)
    expect(getSource(db, added.id)).toBeNull()
  })

  test('a source an operator adds is third-party, whatever it is called', () => {
    const { db } = freshDb()
    expect(addSource(db, { label: 'Official', driver: 'github', location: 'https://example/x' }).official).toBe(false)
  })

  test('listSources returns every source, not just the first', () => {
    const { db } = freshDb()
    seedOfficialSource(db)
    addSource(db, { label: 'a', driver: 'github', location: 'https://example/a' })
    addSource(db, { label: 'b', driver: 'github', location: 'https://example/b' })
    const all = listSources(db)
    expect(all.map((s) => s.label)).toEqual(['Mycelo spores', 'a', 'b'])
  })

  test('a token is masked on every read and readable only through sourceToken', () => {
    const { db } = freshDb()
    const added = addSource(db, { label: 'private', driver: 'github', location: 'https://example/x', token: 'ghp_secret' })
    expect(added.token).toBe(TOKEN_MASK)
    expect(getSource(db, added.id)?.token).toBe(TOKEN_MASK)
    expect(listSources(db)[0]?.token).toBe(TOKEN_MASK)
    expect(sourceToken(db, added.id)).toBe('ghp_secret')
  })

  test('a source with no token reports none rather than a mask', () => {
    const { db } = freshDb()
    const added = addSource(db, { label: 'public', driver: 'github', location: 'https://example/x' })
    expect(added.token).toBeUndefined()
    expect(sourceToken(db, added.id)).toBeNull()
  })

  test('writing the mask back keeps the stored token, and an empty string clears it', () => {
    // Phase 7.5 half A's precedent: a form round-trips the mask, so a write that sends it
    // back is skipped as a value rather than stored.
    const { db } = freshDb()
    const added = addSource(db, { label: 'p', driver: 'github', location: 'https://example/x', token: 'ghp_secret' })
    updateSource(db, added.id, { label: 'renamed', token: TOKEN_MASK })
    expect(sourceToken(db, added.id)).toBe('ghp_secret')
    expect(getSource(db, added.id)?.label).toBe('renamed')
    updateSource(db, added.id, { token: '' })
    expect(sourceToken(db, added.id)).toBeNull()
  })

  test('a patch of nothing but the mask is a no-op, not a throw', () => {
    const { db } = freshDb()
    const added = addSource(db, { label: 'p', driver: 'github', location: 'https://example/x', token: 'ghp_secret' })
    const result = updateSource(db, added.id, { token: TOKEN_MASK })
    expect(result?.label).toBe('p')
    expect(sourceToken(db, added.id)).toBe('ghp_secret')
  })

  test('an empty patch is a no-op, not a throw', () => {
    const { db } = freshDb()
    const added = addSource(db, { label: 'p', driver: 'github', location: 'https://example/x' })
    const result = updateSource(db, added.id, {})
    expect(result?.label).toBe('p')
  })

  test('updateSource writes location', () => {
    const { db } = freshDb()
    const added = addSource(db, { label: 'x', driver: 'github', location: 'https://example/old' })
    const updated = updateSource(db, added.id, { location: 'https://example/new' })
    expect(updated?.location).toBe('https://example/new')
  })
})

describe('upsertLocalSource', () => {
  test('one source per distinct local root, idempotent per root', () => {
    const { db } = freshDb()
    upsertLocalSource(db, '/roots/a')
    upsertLocalSource(db, '/roots/b')
    upsertLocalSource(db, '/roots/a')
    const locals = listSources(db).filter((s) => s.driver === 'local')
    expect(locals.map((s) => s.location)).toEqual(['/roots/a', '/roots/b'])
  })
})
