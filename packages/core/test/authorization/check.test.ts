import { describe, expect, it } from 'bun:test'
import { authorize } from '../../src/authorization/check.js'

describe('authorize', () => {
  it('denies when the principal holds no pattern at all', () => {
    expect(authorize('media.movies', [])).toBe(false)
  })

  it('denies a command no pattern names, which is the default for a newly installed one', () => {
    expect(authorize('media.movies', ['radarr.*', 'admin.plugins'])).toBe(false)
  })

  it('allows an exact match', () => {
    expect(authorize('media.movies', ['media.movies'])).toBe(true)
  })

  it('allows a plugin wildcard for any command of that plugin', () => {
    expect(authorize('media.movies', ['media.*'])).toBe(true)
    expect(authorize('media.where', ['media.*'])).toBe(true)
  })

  it('allows the global wildcard', () => {
    expect(authorize('anything.at-all', ['*'])).toBe(true)
  })

  it('takes the union, so one permissive role is enough', () => {
    expect(authorize('media.movies', ['admin.plugins', 'media.*'])).toBe(true)
  })

  it('does not let a plugin wildcard reach another plugin whose name merely starts the same', () => {
    expect(authorize('mediaserver.movies', ['media.*'])).toBe(false)
  })

  it('does not treat a command wildcard as a plugin wildcard', () => {
    expect(authorize('media.movies', ['*.movies'])).toBe(false)
  })

  it('ignores a pattern with no dot that is not the global wildcard', () => {
    expect(authorize('media.movies', ['media'])).toBe(false)
  })

  it('does not let a dotted command name be reached by a partial prefix', () => {
    expect(authorize('media.movies', ['media.mov*'])).toBe(false)
  })
})
