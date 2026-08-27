import { describe, expect, it } from 'bun:test'
import type { ChannelIdentity } from '@mycelo/septum'
import { createMembershipCache } from '../../src/admission/membership.js'
import type { GerminatedHypha } from '../../src/germination/registry.js'

function hypha(name: string, capabilities: string[], members: ChannelIdentity[]): {
  germinated: GerminatedHypha
  calls: () => number
} {
  let calls = 0
  const germinated = {
    name,
    config: {},
    manifest: { kind: 'hypha' as const, name, septum: '^0.11', capabilities },
    instance: {
      connect: () => Promise.resolve(),
      listen: () => {},
      stop: () => Promise.resolve(),
      send: () => Promise.resolve(),
      listGroupMembers: () => { calls += 1; return Promise.resolve(members) },
    },
  } as unknown as GerminatedHypha
  return { germinated, calls: () => calls }
}

const alice: ChannelIdentity = { channel: 'console', externalId: 'alice' }

describe('createMembershipCache', () => {
  it('asks the hypha once and serves the second call from cache', async () => {
    const h = hypha('console', ['group_membership'], [alice])
    const clock = 0
    const cache = createMembershipCache([h.germinated], { ttlMs: 1000, now: () => clock })
    expect(await cache.members('console', 'g1')).toEqual([alice])
    expect(await cache.members('console', 'g1')).toEqual([alice])
    expect(h.calls()).toBe(1)
  })

  it('asks again once the TTL has elapsed', async () => {
    const h = hypha('console', ['group_membership'], [alice])
    let clock = 0
    const cache = createMembershipCache([h.germinated], { ttlMs: 1000, now: () => clock })
    await cache.members('console', 'g1')
    clock = 1001
    await cache.members('console', 'g1')
    expect(h.calls()).toBe(2)
  })

  it('does not serve one group from another group\'s cache', async () => {
    const h = hypha('console', ['group_membership'], [alice])
    const cache = createMembershipCache([h.germinated], { ttlMs: 1000, now: () => 0 })
    await cache.members('console', 'g1')
    await cache.members('console', 'g2')
    expect(h.calls()).toBe(2)
  })

  it('returns null when the channel declares no group_membership capability', async () => {
    const h = hypha('console', [], [alice])
    const cache = createMembershipCache([h.germinated], { now: () => 0 })
    expect(await cache.members('console', 'g1')).toBeNull()
    expect(h.calls()).toBe(0)
  })

  it('returns null for a channel it has never heard of', async () => {
    const cache = createMembershipCache([], { now: () => 0 })
    expect(await cache.members('signal', 'g1')).toBeNull()
  })

  it('does not cache a failed lookup, so a transient outage is retried', async () => {
    let calls = 0
    const germinated = {
      name: 'console', config: {},
      manifest: { kind: 'hypha' as const, name: 'console', septum: '^0.11', capabilities: ['group_membership'] },
      instance: {
        connect: () => Promise.resolve(), listen: () => {}, stop: () => Promise.resolve(),
        send: () => Promise.resolve(),
        listGroupMembers: () => {
          calls += 1
          return calls === 1 ? Promise.reject(new Error('upstream down')) : Promise.resolve([alice])
        },
      },
    } as unknown as GerminatedHypha
    const cache = createMembershipCache([germinated], { ttlMs: 1000, now: () => 0 })
    expect(cache.members('console', 'g1')).rejects.toThrow('upstream down')
    expect(await cache.members('console', 'g1')).toEqual([alice])
    expect(calls).toBe(2)
  })

  it('requireCapability throws for a channel that cannot enforce the rule, naming both', () => {
    const h = hypha('console', [], [alice])
    const cache = createMembershipCache([h.germinated], { now: () => 0 })
    expect(() => cache.requireCapability('console', 'group_membership'))
      .toThrow(/console.*group_membership/)
  })

  it('requireCapability is silent when the capability is declared', () => {
    const h = hypha('console', ['group_membership'], [alice])
    const cache = createMembershipCache([h.germinated], { now: () => 0 })
    expect(() => cache.requireCapability('console', 'group_membership')).not.toThrow()
  })

  it('requireCapability throws for an unknown channel', () => {
    const cache = createMembershipCache([], { now: () => 0 })
    expect(() => cache.requireCapability('signal', 'group_membership')).toThrow(/signal/)
  })

  it('the cache evicts its oldest entry past the bound', async () => {
    // Asserted through behaviour, never through a size(): MembershipCache exposes only
    // members() and requireCapability(), and widening a public shape for a test is backwards.
    const a = hypha('a', ['group_membership'], [])
    const cache = createMembershipCache([a.germinated], { maxEntries: 2 })
    await cache.members('a', 'g1')
    await cache.members('a', 'g2')
    await cache.members('a', 'g3') // evicts g1
    const before = a.calls()
    await cache.members('a', 'g1') // evicted, so it must go back to the channel
    expect(a.calls()).toBe(before + 1)
  })
})

// listGroupMembers is plugin code: the contract promises an array or null, and an
// inhibitor written to it checks `=== null` before calling .some().
describe('a listGroupMembers that breaks its contract', () => {
  const returning = (value: unknown): GerminatedHypha => ({
    name: 'console', config: {},
    manifest: { kind: 'hypha' as const, name: 'console', septum: '^0.11', capabilities: ['group_membership'] },
    instance: {
      connect: () => Promise.resolve(),
      listen: () => {},
      stop: () => Promise.resolve(),
      send: () => Promise.resolve(),
      listGroupMembers: () => Promise.resolve(value),
    },
  } as unknown as GerminatedHypha)

  it.each([
    ['undefined', undefined],
    ['a bare object', { alice: true }],
    ['a string', 'alice'],
  ])('resolves null rather than %s, and caches nothing', async (_label, value) => {
    const cache = createMembershipCache([returning(value)])
    expect(await cache.members('console', 'g1')).toBeNull()
    expect(await cache.members('console', 'g1')).toBeNull()
  })
})
