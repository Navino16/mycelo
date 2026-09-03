import { describe, expect, it } from 'bun:test'
import { allCommands, effectiveCommands, effectiveWildcards } from '../src/rights.ts'
import type { CommandGroups, RoleDto } from '../src/api/types.ts'

const ROLES: readonly RoleDto[] = [
  { name: 'media', builtin: false, patterns: ['radarr.*'] },
  { name: 'basic', builtin: false, patterns: ['help.help'] },
  { name: 'admin', builtin: true, patterns: ['*'] },
]

const COMMANDS: CommandGroups = {
  radarr: [
    { plugin: 'radarr', command: 'search', declared: 'search', qualified: 'radarr.search', description: 'a', capabilities: [] },
    { plugin: 'radarr', command: 'add', declared: 'add', qualified: 'radarr.add', description: 'b', capabilities: [] },
  ],
  help: [
    { plugin: 'help', command: 'help', declared: 'help', qualified: 'help.help', description: 'c', capabilities: [] },
  ],
}

describe('the command registry, flattened', () => {
  it('flattens every group in the payload, in the payload’s own order', () => {
    expect(allCommands(COMMANDS).map((c) => c.qualified))
      .toEqual(['radarr.search', 'radarr.add', 'help.help'])
  })

  // The denominator of `May run {granted} of {total}` and the pool the numerator filters are
  // now the same call, so a malformed payload cannot make the two halves disagree.
  it('answers nothing for a payload that is not the group object', () => {
    expect(allCommands(null)).toEqual([])
    expect(allCommands(undefined)).toEqual([])
    expect(allCommands('nope')).toEqual([])
    expect(allCommands([])).toEqual([])
  })

  it('skips a group that is not an array rather than throwing', () => {
    expect(allCommands({ radarr: 'nope' })).toEqual([])
  })
})

describe('effective rights', () => {
  // Two roles, one wildcard and one single grant: a `roles[0]`-shaped join answers two of
  // these three and passes any single-role fixture.
  it('unions every role the person holds', () => {
    const commands = effectiveCommands(['media', 'basic'], ROLES, COMMANDS)

    expect(commands.map((c) => c.qualified).sort()).toEqual(['help.help', 'radarr.add', 'radarr.search'])
  })

  it('answers nothing for a person holding no role', () => {
    expect(effectiveCommands([], ROLES, COMMANDS)).toEqual([])
  })

  it('answers everything for a role holding *', () => {
    expect(effectiveCommands(['admin'], ROLES, COMMANDS)).toHaveLength(3)
  })

  it('ignores a role name the roles list does not hold', () => {
    expect(effectiveCommands(['ghost'], ROLES, COMMANDS)).toEqual([])
  })

  // A command is listed once however many of the person's roles reach it.
  it('lists a command reached by two roles at once only once', () => {
    expect(effectiveCommands(['media', 'admin'], ROLES, COMMANDS)).toHaveLength(3)
  })

  it('reports the wildcards those roles hold, deduplicated', () => {
    expect(effectiveWildcards(['media', 'basic'], ROLES)).toEqual(['radarr.*'])
    expect(effectiveWildcards(['basic'], ROLES)).toEqual([])
  })

  it('deduplicates a wildcard two roles both hold', () => {
    const shared: readonly RoleDto[] = [
      { name: 'a', builtin: false, patterns: ['radarr.*'] },
      { name: 'b', builtin: false, patterns: ['radarr.*', '*'] },
    ]

    expect(effectiveWildcards(['a', 'b'], shared)).toEqual(['radarr.*', '*'])
  })

  // The payloads cross the API boundary unchecked; a malformed one must answer empty, not throw.
  it('survives a roles list and a command group that are not arrays', () => {
    expect(effectiveCommands(['media'], ROLES, { radarr: 'nope' } as unknown as CommandGroups)).toEqual([])
    expect(effectiveWildcards(['media'], 'nope' as unknown as readonly RoleDto[])).toEqual([])
  })
})
