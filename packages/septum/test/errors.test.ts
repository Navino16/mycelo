import { describe, expect, it } from 'bun:test'
import { CapabilityMissingError, RhizaUnreachableError } from '../src/errors.js'

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

  it('all are instances of Error', () => {
    expect(new RhizaUnreachableError('x')).toBeInstanceOf(Error)
  })
})
