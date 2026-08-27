import { describe, expect, it } from 'bun:test'
import { CONVERSATION_KINDS, MYCELIUM_SCOPES } from '../src/mycelium.js'

// The scope *interfaces* are types, erased at runtime: their claims live in
// mycelium.test-d.ts, which `bun run typecheck` checks. Only the constant is testable here.
describe('MYCELIUM_SCOPES', () => {
  // A published runtime constant: consumers read these strings, so renaming one is a
  // breaking change. Asserted whole, not sampled.
  it('publishes exactly these sixteen scope names, in this order', () => {
    expect(MYCELIUM_SCOPES).toEqual([
      'principals.read',
      'principals.manage',
      'roles.read',
      'roles.assign',
      'roles.manage',
      'plugins.read',
      'plugins.toggle',
      'plugins.configure',
      'health.read',
      'messages.send',
      'messages.broadcast',
      'conversations.read',
      'restrictions.manage',
      'locale.manage',
      'commands.read',
      'sources.manage',
    ])
  })
})

describe('CONVERSATION_KINDS', () => {
  // The core's onOutOfContext computes `context.${where}` against its own catalogue
  // (packages/core/translations/core/*.yaml); a third value here with no matching key
  // would render raw. Asserted whole, not sampled.
  it('publishes exactly these two conversation kinds', () => {
    expect(CONVERSATION_KINDS).toEqual(['dm', 'group'])
  })
})
