import { describe, expect, test } from 'bun:test'
import {
  addSource, deleteSource, getSource, listSources, seedOfficialSource, sourceToken, TOKEN_MASK, updateSource,
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
})
