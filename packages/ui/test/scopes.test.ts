import { describe, expect, it } from 'bun:test'
import { SCOPE_RISK, SCOPE_SENTENCE, highRiskScopes, riskOf } from '../src/scopes.ts'

describe('scope risk', () => {
  it('grades every scope the sentences cover, so no scope renders ungraded', () => {
    expect(Object.keys(SCOPE_RISK).sort()).toEqual(Object.keys(SCOPE_SENTENCE).sort())
  })

  it('grades the rights-widening scopes high', () => {
    expect(highRiskScopes(['roles.assign', 'health.read'])).toEqual(['roles.assign'])
    expect(SCOPE_RISK['roles.manage']).toBe('high')
    expect(SCOPE_RISK['plugins.configure']).toBe('high')
    expect(SCOPE_RISK['plugins.toggle']).toBe('high')
    expect(SCOPE_RISK['principals.manage']).toBe('high')
    expect(SCOPE_RISK['restrictions.manage']).toBe('high')
    expect(SCOPE_RISK['sources.manage']).toBe('high')
    expect(SCOPE_RISK['messages.broadcast']).toBe('high')
  })

  // The discriminating half: a grader that answers 'high' for everything passes the case above.
  it('grades the read-only scopes low', () => {
    expect(highRiskScopes(['health.read', 'commands.read', 'plugins.read', 'roles.read'])).toEqual([])
    expect(highRiskScopes(['principals.read', 'messages.send', 'conversations.read', 'locale.manage']))
      .toEqual([])
  })

  it('keeps the high ones in the order the manifest declared them, not a sorted one', () => {
    expect(highRiskScopes(['sources.manage', 'health.read', 'roles.assign']))
      .toEqual(['sources.manage', 'roles.assign'])
  })

  // A scope this UI has not caught up with cannot be promised harmless, so it grades high.
  // riskOf and highRiskScopes must default the same way: a scope graded high in the consent
  // alert and painted low in the table is the same unknown scope told two ways.
  it('grades a scope it does not know as high through riskOf too', () => {
    expect(riskOf('future.scope')).toBe('high')
    expect(riskOf('plugins.read')).toBe('low')
  })

  it('treats a scope it does not know as high rather than silently low', () => {
    expect(highRiskScopes(['not.a.scope'])).toEqual(['not.a.scope'])
  })
})
