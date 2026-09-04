import { describe, expect, it } from 'bun:test'
import { coversPlugin, grants, wildcardsIn } from '../src/patterns.ts'

describe('what a role grants', () => {
  it('matches an exact command', () => {
    expect(grants(['radarr.add'], 'radarr.add')).toBe(true)
    expect(grants(['radarr.add'], 'radarr.remove')).toBe(false)
  })

  it('matches a plugin wildcard, and does not leak to another plugin', () => {
    expect(grants(['radarr.*'], 'radarr.remove')).toBe(true)
    expect(grants(['radarr.*'], 'plex.list')).toBe(false)
  })

  it('matches everything under a bare star', () => {
    expect(grants(['*'], 'anything.at.all')).toBe(true)
  })

  // The distinction the screen is built on: 'all' is rendered as a wildcard, never as ticks.
  it('separates covering a plugin by wildcard from ticking each of its commands', () => {
    expect(coversPlugin(['radarr.*'], 'radarr')).toBe('all')
    expect(coversPlugin(['*'], 'radarr')).toBe('all')
    expect(coversPlugin(['radarr.add'], 'radarr')).toBe('some')
    expect(coversPlugin(['plex.add'], 'radarr')).toBe('none')
  })

  it('lists the wildcards a role holds, so the editor can show them as themselves', () => {
    expect(wildcardsIn(['*', 'radarr.*', 'plex.list'])).toEqual(['*', 'radarr.*'])
  })

  // The core's authorize() (authorization/check.ts) accepts exactly three forms. A UI that
  // grants on a fourth would tick a box the bot then refuses to honour.
  it('grants nothing for a near-miss form: prefix globbing, a bare dot-star, or a bare command', () => {
    expect(grants(['admin.pl*'], 'admin.plugins')).toBe(false)
    expect(grants(['.*'], 'admin.plugins')).toBe(false)
    expect(grants(['admin'], 'admin.plugins')).toBe(false)
  })

  it('covers nothing for the same near-miss forms', () => {
    expect(coversPlugin(['admin.pl*'], 'admin')).toBe('none')
    expect(coversPlugin(['.*'], 'admin')).toBe('none')
    expect(coversPlugin(['admin'], 'admin')).toBe('none')
  })

  // Mirrors check.ts:7's dot === -1 guard: a dotless qualified name is its own plugin, not
  // itself minus its last character.
  it('grants a dotless qualified name through its own wildcard, without truncating it', () => {
    expect(grants(['ping.*'], 'ping')).toBe(true)
  })
})
