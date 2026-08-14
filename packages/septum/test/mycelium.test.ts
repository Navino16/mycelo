import { describe, expect, it } from 'bun:test'
import { MYCELIUM_SCOPES } from '../src/mycelium.js'

// The scope *interfaces* are types, erased at runtime: their claims live in
// mycelium.test-d.ts, which `bun run typecheck` checks. Only the constant is testable here.
describe('MYCELIUM_SCOPES', () => {
  // A published runtime constant: consumers read these strings, so renaming one is a
  // breaking change. Asserted whole, not sampled.
  it('publishes exactly these thirteen scope names, in this order', () => {
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
    ])
  })
})
