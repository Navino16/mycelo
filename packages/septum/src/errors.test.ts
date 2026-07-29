import { describe, expect, it } from 'vitest'
import { CapabilityMissingError, RhizaUnreachableError, ScopeDeniedError } from './errors.js'

describe('errors', () => {
  it('RhizaUnreachableError names the rhiza and keeps the cause', () => {
    const cause = new Error('ECONNREFUSED')
    const e = new RhizaUnreachableError('radarr', cause)
    expect(e.rhiza).toBe('radarr')
    expect(e.name).toBe('RhizaUnreachableError')
    expect(e.cause).toBe(cause)
    expect(e.message).toContain('radarr')
  })

  it('CapabilityMissingError names both channel and capability', () => {
    const e = new CapabilityMissingError('signal', 'reactions')
    expect(e.channel).toBe('signal')
    expect(e.capability).toBe('reactions')
    expect(e.message).toContain('reactions')
  })

  it('ScopeDeniedError names the scope', () => {
    const e = new ScopeDeniedError('roles.assign')
    expect(e.scope).toBe('roles.assign')
  })

  it('all are instances of Error', () => {
    expect(new ScopeDeniedError('x')).toBeInstanceOf(Error)
  })
})
