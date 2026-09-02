import { describe, expect, it } from 'bun:test'
import type { Germination } from '../../src/boot/state.js'
import { aggregateRuntimeHealth } from '../../src/supervision/health.js'
import type { Registry } from '../../src/germination/registry.js'

function registry(over: Partial<Registry>): Registry {
  return {
    hyphae: [], enzymes: [], rhizas: [], inhibitors: [], dormant: [],
    routes: new Map(), order: [], brokenEnforcing: [], catalogs: new Map(),
    ...over,
  }
}

const NO_ADMISSION = { admission: { blockedSinceBoot: () => 0 } }

describe('aggregateRuntimeHealth', () => {
  it('reports degraded with its failure and nothing else known', async () => {
    const germination: Germination = {
      status: 'degraded',
      failure: { kind: 'cycle', message: 'cycle: a -> b -> a', spores: ['a', 'b'] },
    }
    const health = await aggregateRuntimeHealth(germination)
    expect(health.mode).toBe('degraded')
    expect(health.failure).toMatchObject({ kind: 'cycle' })
    // Nothing germinated, so nothing is known about any individual plugin (spec §4.1).
    expect(health.dormant).toEqual([])
    expect(health.rhizas).toEqual([])
  })

  it('carries every dormant spore, not only the last', async () => {
    const germination = {
      status: 'germinated' as const,
      mycelium: {
        registry: registry({
          dormant: [{ name: 'a', reason: 'boom' }, { name: 'b', reason: 'bang' }],
        }),
        ...NO_ADMISSION,
      },
    } as unknown as Germination
    const health = await aggregateRuntimeHealth(germination)
    // The plural case: phase 5.5's mutation campaign found a set collapsed to its last
    // element surviving a whole suite built on single-element fixtures.
    expect(health.dormant.map((d) => d.name)).toEqual(['a', 'b'])
  })

  it('keeps enforcingBlocked separate from dormant', async () => {
    const germination = {
      status: 'germinated' as const,
      mycelium: {
        registry: registry({
          dormant: [{ name: 'other', reason: 'boom' }],
          brokenEnforcing: ['gate'],
        }),
        ...NO_ADMISSION,
      },
    } as unknown as Germination
    const health = await aggregateRuntimeHealth(germination)
    // Disjoint fixture values: a swap between the two source fields must be distinguishable,
    // not merely absent from dormant (spec §11).
    expect(health.enforcingBlocked).toEqual(['gate'])
    expect(health.dormant).toEqual([{ name: 'other', reason: 'boom' }])
  })

  // The plural case for enforcingBlocked, the sibling of the dormant one above. Phase 5.5's
  // worst survivor was exactly this shape on a security list (campaign M24): two broken
  // enforcing inhibitors, one reported, and the bot still refusing everything after the fix.
  it('carries every enforcing-blocked inhibitor, not only the last', async () => {
    const germination = {
      status: 'germinated' as const,
      mycelium: { registry: registry({ brokenEnforcing: ['gate', 'guard'] }), ...NO_ADMISSION },
    } as unknown as Germination
    expect((await aggregateRuntimeHealth(germination)).enforcingBlocked).toEqual(['gate', 'guard'])
  })

  it('reports every rhiza\'s health, not only the first', async () => {
    const rhiza = (name: string, state: string): unknown => ({
      name,
      instance: { health: () => Promise.resolve({ state, checkedAt: new Date(0) }) },
    })
    const germination = {
      status: 'germinated' as const,
      mycelium: {
        registry: registry({ rhizas: [rhiza('a', 'healthy'), rhiza('b', 'unreachable')] as never }),
        ...NO_ADMISSION,
      },
    } as unknown as Germination
    const health = await aggregateRuntimeHealth(germination)
    // Distinct states, so a collapse to one entry cannot be mistaken for a duplicate.
    expect(health.rhizas.map((r) => [r.rhiza, r.status.state])).toEqual([['a', 'healthy'], ['b', 'unreachable']])
  })

  // The synchronous half of the same guard: `await r.instance.health()` covers a throw and a
  // rejection alike, and a healthy sibling must still be reported (spec §11).
  it("keeps reporting the other rhizas when one health() throws synchronously", async () => {
    const germination = {
      status: 'germinated' as const,
      mycelium: {
        registry: registry({
          rhizas: [
            { name: 'boom', instance: { health: () => { throw new Error('socket closed') } } },
            { name: 'fine', instance: { health: () => Promise.resolve({ state: 'healthy', checkedAt: new Date(0) }) } },
          ] as never,
        }),
        ...NO_ADMISSION,
      },
    } as unknown as Germination
    const health = await aggregateRuntimeHealth(germination)
    expect(health.rhizas.map((r) => [r.rhiza, r.status.state, r.status.detail]))
      .toEqual([['boom', 'unreachable', 'socket closed'], ['fine', 'healthy', undefined]])
  })

  it('answers starting as degraded rather than inventing a third mode', async () => {
    expect((await aggregateRuntimeHealth({ status: 'starting' })).mode).toBe('degraded')
  })
})
