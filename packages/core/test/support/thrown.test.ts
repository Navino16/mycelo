import { describe, expect, it } from 'bun:test'
import { describeConfigError, describeFault, describeThrown } from '../../src/support/thrown.js'

// The guard exists for a plugin whose `error` predates 0.8's declared issue shape, and the
// same task migrated every temp-spore ConfigSchema in the suite onto that shape — removing
// every input it was written for. Restoring the naive `e.issues.map(...)` left 846 green.
describe('describeConfigError', () => {
  it('renders every issue, joined, not just the first', () => {
    expect(describeConfigError({
      issues: [
        { path: ['url'], message: 'expected a url' },
        { path: ['token'], message: 'required' },
      ],
    })).toBe('url: expected a url; token: required')
  })

  it('renders an array index in the path', () => {
    expect(describeConfigError({ issues: [{ path: ['services', 0, 'url'], message: 'bad url' }] }))
      .toBe('services.0.url: bad url')
  })

  // ConfigIssue.path is readonly PropertyKey[], so a symbol is inside the contract, and
  // Array.prototype.join throws on one — hence String() per segment.
  it('renders a symbol in the path instead of throwing', () => {
    const s = Symbol('s')
    expect(describeConfigError({ issues: [{ path: [s], message: 'm' }] })).toBe('Symbol(s): m')
  })

  it('renders a whole-object refusal as its message alone', () => {
    expect(describeConfigError({ issues: [{ path: [], message: 'socket or tcp, not both' }] }))
      .toBe('socket or tcp, not both')
  })

  it("keeps a pre-0.8 plugin's bare-string error rather than dropping it", () => {
    expect(describeConfigError('groupId is required')).toBe('groupId is required')
  })

  it("keeps an Error's own message when the plugin rejected with one", () => {
    expect(describeConfigError(new Error('config is unreadable'))).toBe('config is unreadable')
  })

  it('falls back to a generic line only when the refusal says nothing at all', () => {
    for (const error of [undefined, null, {}, { issues: [] }, { issues: 'nope' }, '']) {
      expect(describeConfigError(error)).toBe('the plugin reported no further detail')
    }
  })

  it('names the field but not the message when the message is not a string', () => {
    expect(describeConfigError({ issues: [{ path: ['url'], message: 7 }] })).toBe('url: unspecified issue')
  })
})

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
