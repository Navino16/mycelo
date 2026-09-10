import { describe, expect, it } from 'bun:test'
import { describeFault, describeThrown } from '../../src/support/thrown.js'

// The asymmetry is deliberate: describeThrown's output reaches a client through
// GerminationFailure.message, describeFault's only an operator's log.
describe('describeThrown and describeFault', () => {
  it('never lets a stack reach the client, and always keeps it for the log', () => {
    const e = new Error('boom')
    expect(describeThrown(e)).toBe('boom')
    expect(describeFault(e)).toContain('boom')
    expect(describeFault(e)).toContain('thrown.test.ts')
  })

  it('reduces a non-Error throw to a fixed string for the client but renders it for the log', () => {
    expect(describeThrown({ message: 'pretend' })).toBe('unknown error')
    expect(describeFault('plain string')).toBe('plain string')
  })
})
