import { describe, expect, it } from 'bun:test'
import type { Germination } from '../../src/boot/state.js'
import { aggregateHealth, aggregateRuntimeHealth } from '../../src/supervision/health.js'
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
          dormant: [
            { name: 'a', refusal: { domain: 'common', key: 'refusal.germination.rhizaNoApi' } },
            { name: 'b', refusal: { domain: 'common', key: 'refusal.germination.inhibitorNoInspect' } },
          ],
        }),
        ...NO_ADMISSION,
      },
    } as unknown as Germination
    const health = await aggregateRuntimeHealth(germination)
    // The plural case: phase 5.5's mutation campaign found a set collapsed to its last
    // element surviving a whole suite built on single-element fixtures.
    expect(health.dormant.map((d) => [d.name, d.refusal.key])).toEqual([
      ['a', 'refusal.germination.rhizaNoApi'],
      ['b', 'refusal.germination.inhibitorNoInspect'],
    ])
  })

  it('keeps enforcingBlocked separate from dormant', async () => {
    const germination = {
      status: 'germinated' as const,
      mycelium: {
        registry: registry({
          dormant: [{
            name: 'other',
            refusal: { domain: 'common', key: 'refusal.germination.rhizaNoApi' },
          }],
          brokenEnforcing: ['gate'],
        }),
        ...NO_ADMISSION,
      },
    } as unknown as Germination
    const health = await aggregateRuntimeHealth(germination)
    // Disjoint fixture values: a swap between the two source fields must be distinguishable,
    // not merely absent from dormant (spec §11).
    expect(health.enforcingBlocked).toEqual(['gate'])
    expect(health.dormant).toEqual([{
      name: 'other',
      refusal: { domain: 'common', key: 'refusal.germination.rhizaNoApi' },
    }])
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

  it('carries the refusal beside each dormant entry', async () => {
    const germination = {
      status: 'germinated' as const,
      mycelium: {
        registry: registry({
          dormant: [{
            name: 'broken',
            refusal: { domain: 'common', key: 'refusal.germination.rhizaNoApi' },
          }],
        }),
        ...NO_ADMISSION,
      },
    } as unknown as Germination
    const health = await aggregateRuntimeHealth(germination)
    expect(health.dormant[0]?.refusal.key).toBe('refusal.germination.rhizaNoApi')
  })

  it('answers starting as degraded rather than inventing a third mode', async () => {
    expect((await aggregateRuntimeHealth({ status: 'starting' })).mode).toBe('degraded')
  })
})

describe('the mute counter reaches the health payload', () => {
  // A non-zero fixture: every other case here counts nothing, so a hardcoded 0 read as
  // "the chain's own count" survived the whole suite.
  it('reports the chain\'s own count, not a zero of its own', async () => {
    const germination = {
      status: 'germinated' as const,
      mycelium: {
        registry: registry({ brokenEnforcing: ['gate'] }),
        admission: { blockedSinceBoot: () => 7 },
      },
    } as unknown as Germination

    expect((await aggregateRuntimeHealth(germination)).blockedSinceBoot).toBe(7)
  })

  it('answers zero for a substrate that never germinated', async () => {
    expect((await aggregateRuntimeHealth({ status: 'starting' })).blockedSinceBoot).toBe(0)
  })
})

describe('aggregateHealth timeout', () => {
  // 9.5 review, M8: aggregateHealth caught a throw but not a `health()` that never resolves, and
  // the graph became a second route a hanging rhiza could hang. A never-settling promise, not a
  // slow one: a timer-based fake would pass against a `setTimeout` the code does not have.
  it('reports a rhiza whose health() never resolves as unreachable', async () => {
    const hanging = registry({
      rhizas: [{ name: 'plex', instance: { health: () => new Promise<never>(() => undefined) } }],
    } as unknown as Partial<Registry>)
    const health = await aggregateHealth(hanging, 20)
    expect(health).toHaveLength(1)
    expect(health[0]?.status.state).toBe('unreachable')
    expect(health[0]?.status.detail).toContain('did not answer')
  })

  it('still reports a healthy rhiza that answers well inside the bound', async () => {
    const quick = registry({
      rhizas: [{
        name: 'plex',
        instance: { health: () => Promise.resolve({ state: 'healthy' as const, checkedAt: new Date() }) },
      }],
    } as unknown as Partial<Registry>)
    expect((await aggregateHealth(quick, 20))[0]?.status.state).toBe('healthy')
  })
})
