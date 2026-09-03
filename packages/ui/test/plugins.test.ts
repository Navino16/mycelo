import { describe, expect, it } from 'bun:test'
import { pluginsByName } from '../src/plugins.ts'
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
