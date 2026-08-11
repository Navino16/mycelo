import { describe, expect, it } from 'vitest'
import { ManifestError, parseManifest } from '../src/manifest.js'

describe('parseManifest', () => {
  it('accepts a minimal enzyme manifest', () => {
    const m = parseManifest({
      kind: 'enzyme',
      name: 'links',
      septum: '^1.0',
      commands: [{ name: 'links', description: 'Show service links', respond: 'https://example' }],
    })
    expect(m.kind).toBe('enzyme')
    expect(m.name).toBe('links')
  })

  it('accepts an enzyme with mandatory, any_of and optional requirements', () => {
    const m = parseManifest({
      kind: 'enzyme',
      name: 'upcoming-movies',
      septum: '^1.0',
      commands: [{ name: 'upcoming', description: 'Upcoming movies', respond: 'Coming soon' }],
      requires: [
        { rhiza: 'radarr@^2' },
        { any_of: [{ rhiza: 'plex' }, { rhiza: 'jellyfin' }] },
        { rhiza: 'tautulli', optional: true },
      ],
    })
    if (m.kind !== 'enzyme') throw new Error('narrowing failed')
    expect(m.requires).toHaveLength(3)
  })

  it('accepts a hypha declaring capabilities', () => {
    const m = parseManifest({
      kind: 'hypha',
      name: 'signal',
      septum: '^1.0',
      capabilities: ['attachments', 'reactions', 'group_membership'],
    })
    if (m.kind !== 'hypha') throw new Error('narrowing failed')
    expect(m.capabilities).toContain('group_membership')
  })

  it('accepts an inhibitor declaring enforcing', () => {
    const m = parseManifest({
      kind: 'inhibitor',
      name: 'group-gate',
      septum: '^1.0',
      enforcing: true,
    })
    if (m.kind !== 'inhibitor') throw new Error('narrowing failed')
    expect(m.enforcing).toBe(true)
  })

  it('rejects an unknown kind and names the offending path', () => {
    expect(() => parseManifest({ kind: 'fungus', name: 'x', septum: '^1.0' }))
      .toThrow(ManifestError)
    try {
      parseManifest({ kind: 'fungus', name: 'x', septum: '^1.0' })
    } catch (e) {
      expect((e as ManifestError).path).toBe('kind')
    }
  })

  it('rejects an enzyme with no commands', () => {
    try {
      parseManifest({ kind: 'enzyme', name: 'x', septum: '^1.0', commands: [] })
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as ManifestError).path).toBe('commands')
    }
  })

  it('rejects a name that is not a valid identifier', () => {
    try {
      parseManifest({ kind: 'rhiza', name: 'Not A Name', septum: '^1.0' })
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as ManifestError).path).toBe('name')
    }
  })

  it('requires a septum range', () => {
    try {
      parseManifest({ kind: 'rhiza', name: 'radarr' })
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as ManifestError).path).toBe('septum')
    }
  })
})

const enzymeManifest = (command: Record<string, unknown>): unknown => ({
  kind: 'enzyme',
  name: 'helpdesk',
  septum: '^0.2',
  commands: [{ name: 'links', description: 'Service URLs', ...command }],
})

it('accepts a command answered by text', () => {
  const manifest = parseManifest(enzymeManifest({ respond: 'Radarr http://radarr:7878' }))
  expect(manifest.kind).toBe('enzyme')
  if (manifest.kind !== 'enzyme') return
  expect(manifest.commands[0]?.respond).toBe('Radarr http://radarr:7878')
})

it('accepts a command answered by code, including a camelCase handler name', () => {
  const manifest = parseManifest(enzymeManifest({ code: 'handleMutation' }))
  expect(manifest.kind).toBe('enzyme')
  if (manifest.kind !== 'enzyme') return
  expect(manifest.commands[0]?.code).toBe('handleMutation')
})

it('refuses a command carrying both respond and code', () => {
  try {
    parseManifest(enzymeManifest({ respond: 'hi', code: 'handleHi' }))
    throw new Error('should have thrown')
  } catch (e) {
    expect(e).toBeInstanceOf(ManifestError)
    expect((e as ManifestError).message).toBe('a command must declare exactly one of respond: or code:')
    expect((e as ManifestError).path).toBe('commands.0')
  }
})

it('refuses a command carrying neither', () => {
  try {
    parseManifest(enzymeManifest({}))
    throw new Error('should have thrown')
  } catch (e) {
    expect(e).toBeInstanceOf(ManifestError)
    expect((e as ManifestError).message).toBe('a command must declare exactly one of respond: or code:')
    expect((e as ManifestError).path).toBe('commands.0')
  }
})

it('refuses args on a respond: command, since a plain string has no interpolation', () => {
  try {
    parseManifest(enzymeManifest({ respond: 'hi', args: [{ name: 'who', description: 'x' }] }))
    throw new Error('should have thrown')
  } catch (e) {
    expect(e).toBeInstanceOf(ManifestError)
    expect((e as ManifestError).path).toBe('commands.0')
  }
})
