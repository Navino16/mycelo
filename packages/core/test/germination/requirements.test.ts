import { describe, expect, it } from 'bun:test'
import { parseManifest } from '@mycelo/septum'
import { demandsOf } from '../../src/germination/requirements.js'

function enzymeRequiring(requires: readonly unknown[]): ReturnType<typeof parseManifest> {
  return parseManifest({
    kind: 'enzyme',
    name: 'consenter',
    septum: '^0.11',
    commands: [{ name: 'consent', description: 'command.consent.description', respond: 'reply.consent' }],
    requires,
  })
}

describe('the demands a consent screen renders', () => {
  // The mycelium sits second on purpose: with it first, a union collapsed to requires[0]
  // answers correctly and the test proves nothing. The cardinality shape phase 5.5 named.
  it('unions the scopes of every requirement, not the first one\'s', () => {
    const manifest = enzymeRequiring([
      { rhiza: 'radarr' },
      { rhiza: 'mycelium', scopes: ['plugins.read', 'roles.read'] },
    ])

    expect(demandsOf(manifest).scopes).toEqual(['plugins.read', 'roles.read'])
  })

  it('carries every alternative of an any_of group, not just the first', () => {
    const manifest = enzymeRequiring([{ any_of: [{ rhiza: 'radarr' }, { rhiza: 'sonarr' }] }])

    expect(demandsOf(manifest).requires).toEqual([
      { targets: ['radarr', 'sonarr'], anyOf: true, optional: false, scopes: [] },
    ])
  })

  it('reports an optional requirement as optional', () => {
    const manifest = enzymeRequiring([{ rhiza: 'radarr', optional: true }])

    expect(demandsOf(manifest).requires[0]?.optional).toBe(true)
  })
})
