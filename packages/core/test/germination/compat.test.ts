import { describe, expect, it } from 'bun:test'
import { SEPTUM_VERSION } from '@mycelo/septum'
import { septumIncompatibility } from '../../src/germination/compat.js'

describe('septumIncompatibility', () => {
  it('admits a range covering the running septum', () => {
    expect(septumIncompatibility('^0.10', '0.10.2')).toBeUndefined()
    expect(septumIncompatibility('>=0.9.0', '0.10.2')).toBeUndefined()
  })

  it('refuses a bounded caret below the running septum, naming both', () => {
    const reason = septumIncompatibility('^0.9', '0.10.2')
    expect(reason).toContain('^0.9')
    expect(reason).toContain('0.10.2')
  })

  it('refuses a range above the running septum', () => {
    expect(septumIncompatibility('^1.0', '0.10.2')).toContain('^1.0')
  })

  it('distinguishes an unparseable range from an incompatible one', () => {
    // A spore installed by an older core never went through septum's schema guard, so this
    // is reachable and the two sentences must differ (design §10).
    const malformed = septumIncompatibility('not a range', '0.10.2')
    const incompatible = septumIncompatibility('^0.9', '0.10.2')
    expect(malformed).toBeDefined()
    expect(malformed).not.toBe(incompatible)
    expect(malformed).toContain('not a range')
  })

  it('defaults to the septum actually running, not a duplicated constant', () => {
    expect(septumIncompatibility(`^${SEPTUM_VERSION}`)).toBeUndefined()
    expect(septumIncompatibility('^0.1')).toContain(SEPTUM_VERSION)
  })
})
