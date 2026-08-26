import { describe, expect, it } from 'bun:test'
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

it('rejects a respond that is not a string without blaming exclusivity', () => {
  try {
    parseManifest(enzymeManifest({ respond: 42 }))
    throw new Error('should have thrown')
  } catch (e) {
    expect(e).toBeInstanceOf(ManifestError)
    expect((e as ManifestError).message).not.toBe('a command must declare exactly one of respond: or code:')
    expect((e as ManifestError).path).toBe('commands.0')
  }
})

it('rejects a malformed args entry without blaming exclusivity', () => {
  try {
    parseManifest(enzymeManifest({ code: 'handleMutation', args: [{ name: 'who' }] }))
    throw new Error('should have thrown')
  } catch (e) {
    expect(e).toBeInstanceOf(ManifestError)
    expect((e as ManifestError).message).not.toBe('a command must declare exactly one of respond: or code:')
    expect((e as ManifestError).path).toBe('commands.0')
  }
})

describe('mycelium scopes', () => {
  const base = { kind: 'rhiza', name: 'probe', septum: '^0.4' }

  it('accepts a known scope on rhiza mycelium', () => {
    const m = parseManifest({ ...base, requires: [{ rhiza: 'mycelium', scopes: ['plugins.read'] }] })
    expect(m.requires?.[0]).toEqual({ rhiza: 'mycelium', scopes: ['plugins.read'], optional: false })
  })

  it('names a misspelled scope rather than reporting Invalid input', () => {
    try {
      parseManifest({ ...base, requires: [{ rhiza: 'mycelium', scopes: ['role.assign'] }] })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ManifestError)
      expect((e as ManifestError).message).toMatch(/expected one of/)
      expect((e as ManifestError).path).toBe('requires.0.scopes.0')
    }
  })

  it('rejects scopes on any rhiza other than mycelium', () => {
    expect(() => parseManifest({ ...base, requires: [{ rhiza: 'radarr', scopes: ['plugins.read'] }] }))
      .toThrow(/scopes apply only to rhiza 'mycelium'/)
  })
})

describe('any_of', () => {
  const base = { kind: 'rhiza', name: 'probe', septum: '^0.4' }

  it('rejects optional on an any_of requirement rather than silently dropping it', () => {
    expect(() => parseManifest({
      ...base,
      requires: [{ any_of: [{ rhiza: 'plex' }, { rhiza: 'jellyfin' }], optional: true }],
    })).toThrow(ManifestError)
  })

  it('rejects scopes on an any_of requirement rather than silently dropping it', () => {
    expect(() => parseManifest({
      ...base,
      requires: [{ any_of: [{ rhiza: 'plex' }, { rhiza: 'jellyfin' }], scopes: ['plugins.read'] }],
    })).toThrow(ManifestError)
  })

  it('rejects scopes on an any_of alternative rather than silently dropping it', () => {
    expect(() => parseManifest({
      ...base,
      requires: [{ any_of: [{ rhiza: 'plex', scopes: ['plugins.read'] }, { rhiza: 'jellyfin' }] }],
    })).toThrow(ManifestError)
  })
})

it('accepts channel capabilities on a command and leaves them absent when undeclared', () => {
  const parsed = parseManifest({
    kind: 'enzyme', name: 'p', septum: '^0.7',
    commands: [
      { name: 'react', description: 'needs reactions', respond: 'ok', capabilities: ['reactions'] },
      { name: 'plain', description: 'needs nothing', respond: 'ok' },
    ],
  })
  if (parsed.kind !== 'enzyme') throw new Error('expected an enzyme manifest')
  expect(parsed.commands[0]?.capabilities).toEqual(['reactions'])
  expect(parsed.commands[1]?.capabilities).toBeUndefined()
})

it('rejects a capability that is not a ChannelCapability', () => {
  expect(() => parseManifest({
    kind: 'enzyme', name: 'p', septum: '^0.7',
    commands: [{ name: 'c', description: 'd', respond: 'ok', capabilities: ['telepathy'] }],
  })).toThrow(ManifestError)
})

describe('the septum range', () => {
  const base = {
    kind: 'enzyme' as const,
    name: 'x',
    commands: [{ name: 'c', description: 'command.c.description', respond: 'reply.c' }],
  }

  it('accepts every range form Bun.semver actually parses', () => {
    // Measured on Bun 1.4.0. `0.10.x` and `>=0.9 <0.12` are forms this project does not write;
    // `^^0.10` behaves identically to `^0.10`, so refusing it would make the schema stricter
    // than the runtime.
    for (const septum of ['^0.10', '>=0.10.0', '0.10.x', '>=0.9 <0.12', '^^0.10']) {
      expect(parseManifest({ ...base, septum }).septum).toBe(septum)
    }
  })

  it('rejects a range Bun.semver cannot parse, naming the field', () => {
    // An unparseable range matches every version, so without this the core's compatibility
    // check is silently inert for that spore rather than failing loudly (design §10.1).
    try {
      parseManifest({ ...base, septum: 'not a range' })
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as ManifestError).path).toBe('septum')
      expect((e as ManifestError).message).toContain('semver range')
    }
  })

  it('rejects the wildcard forms that match every version', () => {
    for (const septum of ['*', 'latest']) {
      try {
        parseManifest({ ...base, septum })
        throw new Error(`should have thrown for '${septum}'`)
      } catch (e) {
        expect((e as ManifestError).path).toBe('septum')
      }
    }
  })
})
