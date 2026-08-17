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
      },
    } as unknown as Germination
    const health = await aggregateRuntimeHealth(germination)
    // Disjoint fixture values: a swap between the two source fields must be distinguishable,
    // not merely absent from dormant (spec §11).
    expect(health.enforcingBlocked).toEqual(['gate'])
    expect(health.dormant).toEqual([{ name: 'other', reason: 'boom' }])
  })

  it('answers starting as degraded rather than inventing a third mode', async () => {
    expect((await aggregateRuntimeHealth({ status: 'starting' })).mode).toBe('degraded')
  })
})
