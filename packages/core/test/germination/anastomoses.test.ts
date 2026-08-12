import { describe, expect, it } from 'bun:test'
import { parseManifest } from '@mycelo/septum'
import { CycleError, resolve } from '../../src/germination/anastomoses.js'
import type { ReadManifest } from '../../src/germination/manifest.js'

function read(raw: Record<string, unknown>): ReadManifest {
  const manifest = parseManifest(raw)
  return {
    location: { path: `/spores/${manifest.name}`, directory: manifest.name, manifestPath: `/spores/${manifest.name}/spore.yaml` },
    manifest,
  }
}

const rhiza = (name: string, requires?: unknown) =>
  read({ kind: 'rhiza', name, septum: '^0.4', ...(requires === undefined ? {} : { requires }) })

const enzyme = (name: string, requires?: unknown) =>
  read({
    kind: 'enzyme', name, septum: '^0.4',
    commands: [{ name, description: 'x', respond: 'x' }],
    ...(requires === undefined ? {} : { requires }),
  })

const names = (r: { order: readonly { read: ReadManifest }[] }) => r.order.map((s) => s.read.manifest.name)

describe('resolve', () => {
  it('orders a dependent after what it requires', () => {
    const r = resolve([enzyme('media', [{ rhiza: 'mock' }]), rhiza('mock')])
    expect(names(r)).toEqual(['mock', 'media'])
    expect(r.dormant).toEqual([])
  })

  it('leaves a spore dormant when a mandatory rhiza is not installed', () => {
    const r = resolve([enzyme('media', [{ rhiza: 'absent' }])])
    expect(names(r)).toEqual([])
    expect(r.dormant[0]?.reason).toBe("requires rhiza 'absent', which is not installed")
  })

  it('germinates when an optional rhiza is absent, and has() will say false', () => {
    const r = resolve([enzyme('media', [{ rhiza: 'absent', optional: true }])])
    expect(names(r)).toEqual(['media'])
    expect(r.order[0]?.resolved.has('absent')).toBe(false)
  })

  it('collapses any_of to the first installed alternative, not the first declared', () => {
    const r = resolve([enzyme('media', [{ any_of: [{ rhiza: 'nowhere' }, { rhiza: 'mock' }] }]), rhiza('mock')])
    expect(r.order.find((s) => s.read.manifest.name === 'media')?.resolved.has('mock')).toBe(true)
    expect(r.order.find((s) => s.read.manifest.name === 'media')?.resolved.has('nowhere')).toBe(false)
  })

  it('leaves a spore dormant when no any_of alternative is installed', () => {
    const r = resolve([enzyme('media', [{ any_of: [{ rhiza: 'a' }, { rhiza: 'b' }] }])])
    expect(r.dormant[0]?.reason).toBe("requires one of rhiza 'a', 'b' — none is installed")
  })

  it('splits a semver range off a target name, in a plain requirement and an any_of alternative', () => {
    const plain = resolve([enzyme('media', [{ rhiza: 'mock@^2' }]), rhiza('mock')])
    expect(names(plain)).toEqual(['mock', 'media'])
    expect(plain.order.find((s) => s.read.manifest.name === 'media')?.resolved.has('mock')).toBe(true)

    const anyOf = resolve([enzyme('other', [{ any_of: [{ rhiza: 'mock@^2' }, { rhiza: 'nope' }] }]), rhiza('mock')])
    expect(names(anyOf)).toContain('other')
    expect(anyOf.order.find((s) => s.read.manifest.name === 'other')?.resolved.has('mock')).toBe(true)
  })

  it('does not re-collapse any_of onto a healthy alternative once the chosen one turns out dormant (deliberate: spec §6 resolves from manifests alone)', () => {
    const r = resolve([
      enzyme('media', [{ any_of: [{ rhiza: 'plex' }, { rhiza: 'jellyfin' }] }]),
      rhiza('plex', [{ rhiza: 'absent' }]),
      rhiza('jellyfin'),
    ])
    expect(names(r)).not.toContain('media')
    const media = r.dormant.find((d) => d.name === 'media')
    expect(media?.reason).toBe("requires rhiza 'plex', which is dormant: requires rhiza 'absent', which is not installed")
  })

  it('propagates dormancy, naming the proximate cause', () => {
    const r = resolve([enzyme('top', [{ rhiza: 'middle' }]), rhiza('middle', [{ rhiza: 'absent' }])])
    expect(names(r)).toEqual([])
    const top = r.dormant.find((d) => d.name === 'top')
    expect(top?.reason).toBe("requires rhiza 'middle', which is dormant: requires rhiza 'absent', which is not installed")
  })

  // Only a rhiza can be the target of a rhiza: requirement (spec §6), so a cycle over
  // that edge type can only ever run between rhizas — never through an enzyme's name.
  it('throws on a cycle, naming the plugins in order', () => {
    expect(() => resolve([rhiza('a', [{ rhiza: 'b' }]), rhiza('b', [{ rhiza: 'a' }])])).toThrow(CycleError)
    expect(() => resolve([rhiza('a', [{ rhiza: 'b' }]), rhiza('b', [{ rhiza: 'a' }])])).toThrow(/a -> b -> a/)
  })

  it('counts optional edges towards cycle detection, with no exemption', () => {
    expect(() => resolve([rhiza('a', [{ rhiza: 'b', optional: true }]), rhiza('b', [{ rhiza: 'a' }])])).toThrow(CycleError)
    expect(() => resolve([rhiza('a', [{ rhiza: 'b', optional: true }]), rhiza('b', [{ rhiza: 'a' }])])).toThrow(/a -> b -> a/)
  })

  it('treats mycelium as always available and never part of a cycle', () => {
    const r = resolve([enzyme('admin', [{ rhiza: 'mycelium', scopes: ['plugins.read'] }])])
    expect(names(r)).toEqual(['admin'])
    expect(r.order[0]?.scopes).toEqual(['plugins.read'])
  })

  it('leaves a spore dormant when it asks for a scope this phase cannot mount', () => {
    const r = resolve([enzyme('toggler', [{ rhiza: 'mycelium', scopes: ['plugins.toggle'] }])])
    expect(r.dormant[0]?.reason).toBe("requires mycelium scope 'plugins.toggle', which arrives in phase 5")
  })

  it('resolves principals.manage: task 8 mounted it, so phase 4 must not gate it', () => {
    const r = resolve([enzyme('reviewer', [{ rhiza: 'mycelium', scopes: ['principals.manage'] }])])
    expect(names(r)).toEqual(['reviewer'])
    expect(r.dormant).toEqual([])
    expect(r.order[0]?.scopes).toEqual(['principals.manage'])
  })

  it('puts mycelium in the resolved set while keeping it out of the graph', () => {
    const r = resolve([enzyme('admin', [{ rhiza: 'mycelium', scopes: ['plugins.read'] }])])
    expect(names(r)).toEqual(['admin'])
    expect(r.order[0]?.resolved.has('mycelium')).toBe(true)
  })

  it('dedupes overlapping mycelium scopes declared across separate requirement entries', () => {
    const r = resolve([
      enzyme('admin', [
        { rhiza: 'mycelium', scopes: ['plugins.read'] },
        { rhiza: 'mycelium', scopes: ['plugins.read', 'health.read'] },
      ]),
    ])
    expect(r.order[0]?.scopes).toEqual(['plugins.read', 'health.read'])
  })

  it('makes a spore dormant for claiming the reserved name mycelium', () => {
    const r = resolve([enzyme('user', [{ rhiza: 'mycelium' }]), rhiza('mycelium')])
    expect(names(r)).toEqual(['user'])
    expect(r.order[0]?.resolved.has('mycelium')).toBe(true)
    const claimant = r.dormant.find((d) => d.name === 'mycelium')
    expect(claimant?.reason).toBe("the name 'mycelium' is reserved for the core")
  })

  it('reports has() false for an optional dependency that is installed but dormant', () => {
    const r = resolve([
      enzyme('media', [{ rhiza: 'mock', optional: true }]),
      rhiza('mock', [{ rhiza: 'absent' }]),
    ])
    expect(names(r)).toEqual(['media'])
    expect(r.order[0]?.resolved.has('mock')).toBe(false)
  })

  it('leaves a spore dormant when rhiza: names an installed spore that is not a rhiza', () => {
    const r = resolve([enzyme('user', [{ rhiza: 'ping' }]), enzyme('ping')])
    // 'ping' has no requires of its own, so it germinates independently; 'user' is the
    // one that goes dormant for naming an enzyme where a rhiza: requirement needs a rhiza.
    expect(names(r)).toEqual(['ping'])
    const user = r.dormant.find((d) => d.name === 'user')
    expect(user?.reason).toBe("requires rhiza 'ping', which is kind 'enzyme', not a rhiza")
  })

  it('makes the second spore claiming a name dormant', () => {
    const r = resolve([rhiza('mock'), rhiza('mock')])
    expect(names(r)).toEqual(['mock'])
    expect(r.dormant[0]?.reason).toContain('already claimed')
  })
})
