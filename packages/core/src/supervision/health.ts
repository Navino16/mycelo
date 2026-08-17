import type { RhizaHealth } from '@mycelo/septum'
import type { Germination, GerminationFailure } from '../boot/state.js'
import type { Registry } from '../germination/registry.js'

export async function aggregateHealth(registry: Registry): Promise<readonly RhizaHealth[]> {
  return Promise.all(registry.rhizas.map(async (r) => ({ rhiza: r.name, status: await r.instance.health() })))
}

export interface RuntimeHealth {
  mode: 'germinated' | 'degraded'
  failure?: GerminationFailure
  dormant: readonly { name: string, reason: string }[]
  /** Kept apart from `dormant`: any one of these refuses all traffic (design §7). */
  enforcingBlocked: readonly string[]
  rhizas: readonly RhizaHealth[]
}

export async function aggregateRuntimeHealth(germination: Germination): Promise<RuntimeHealth> {
  if (germination.status !== 'germinated') {
    return {
      mode: 'degraded',
      ...(germination.status === 'degraded' ? { failure: germination.failure } : {}),
      dormant: [], enforcingBlocked: [], rhizas: [],
    }
  }
  const { registry } = germination.mycelium
  return {
    mode: 'germinated',
    dormant: registry.dormant.map((d) => ({ name: d.name, reason: d.reason })),
    enforcingBlocked: registry.brokenEnforcing,
    rhizas: await aggregateHealth(registry),
  }
}
