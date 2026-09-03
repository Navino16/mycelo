import { describe, expect, it } from 'bun:test'
import { flatPlugins, pluginsByName } from '../src/plugins.ts'
import type { PluginDto } from '../src/api/types.ts'

function plugin(name: string): PluginDto {
  return { name, commands: [], state: 'germinated', enabled: true }
}

describe('indexing the installed plugins', () => {
  it('indexes every kind by name', () => {
    const map = pluginsByName({
      hypha: [plugin('hypha-signal')],
      rhiza: [plugin('rhiza-plex')],
      enzyme: [],
      inhibitor: [],
      unknown: [plugin('broken')],
    })

    expect([...(map ?? new Map()).keys()].sort()).toEqual(['broken', 'hypha-signal', 'rhiza-plex'])
  })

  // The refused-join rule: null is "said nothing", and a screen renders silence for it —
  // never an empty map, which reads as "known, and nothing is installed".
  it('answers null for a refused join', () => {
    expect(pluginsByName(null)).toBeNull()
    expect(pluginsByName(undefined)).toBeNull()
  })

  it('answers null for a payload that is not the group object', () => {
    expect(pluginsByName([plugin('rhiza-plex')])).toBeNull()
    expect(pluginsByName('nope')).toBeNull()
    expect(pluginsByName(7)).toBeNull()
  })

  it('skips a kind whose value is not an array rather than throwing', () => {
    const map = pluginsByName({ hypha: 'broken', rhiza: [plugin('rhiza-plex')] })

    expect([...(map ?? new Map()).keys()]).toEqual(['rhiza-plex'])
  })
})

describe('flattening the installed plugins', () => {
  // I4: five copies of this loop lived across the screens and the shell. The `unknown` bucket
  // is the one a hand-written copy drops, and it is where a plugin whose manifest never
  // parsed appears.
  it('keeps every kind, the unknown bucket included, in the design\u2019s order', () => {
    const all = flatPlugins({
      hypha: [plugin('hypha-signal')],
      rhiza: [plugin('rhiza-plex')],
      enzyme: [plugin('enzyme-help')],
      inhibitor: [plugin('inhibitor-gate')],
      unknown: [plugin('broken')],
    })

    expect(all.map((p) => p.name))
      .toEqual(['hypha-signal', 'rhiza-plex', 'enzyme-help', 'inhibitor-gate', 'broken'])
  })

  // Unlike pluginsByName, the flat list has no null: a caller that must tell a refusal from an
  // empty substrate reads the settled result, not the length.
  it('answers an empty list for a payload that is not the group object', () => {
    expect(flatPlugins(null)).toEqual([])
    expect(flatPlugins(undefined)).toEqual([])
    expect(flatPlugins([plugin('rhiza-plex')])).toEqual([])
    expect(flatPlugins('nope')).toEqual([])
  })

  it('skips a kind whose value is not an array rather than throwing', () => {
    expect(flatPlugins({ hypha: 'broken', rhiza: [plugin('rhiza-plex')] }).map((p) => p.name))
      .toEqual(['rhiza-plex'])
  })
})
