import type { PluginInfo, RhizaHealth, TranslatableRef } from '@mycelo/septum'
import type { Germination, GerminationFailure } from '../boot/state.js'
import { listPlugins } from '../config/plugins.js'
import type { Registry } from '../germination/registry.js'
import type { Db } from '../persistence/db.js'
import { describeThrown } from '../support/thrown.js'

/**
 * spec §11: a rhiza that never answers is unreachable, exactly like one that throws. Without the
 * bound, one plugin's hanging `health()` hangs `/api/health` and `/api/graph` — the two screens an
 * operator opens *because* something is wrong (9.5 review, M8).
 */
export const HEALTH_TIMEOUT_MS = 5_000

function unreachable(detail: string): RhizaHealth['status'] {
  return { state: 'unreachable', detail, checkedAt: new Date() }
}

/** Rejects rather than resolving, so one `catch` covers a throw, a rejection and a hang alike. */
function afterTimeout(ms: number): { promise: Promise<never>, cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined
  const promise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { reject(new Error(`health() did not answer within ${String(ms)}ms`)) }, ms)
  })
  return { promise, cancel: () => { if (timer !== undefined) clearTimeout(timer) } }
}

export async function aggregateHealth(
  registry: Registry, timeoutMs: number = HEALTH_TIMEOUT_MS,
): Promise<readonly RhizaHealth[]> {
  return Promise.all(registry.rhizas.map(async (r) => {
    const bound = afterTimeout(timeoutMs)
    try {
      return { rhiza: r.name, status: await Promise.race([r.instance.health(), bound.promise]) }
    } catch (e) {
      return { rhiza: r.name, status: unreachable(describeThrown(e)) }
    } finally {
      // Or the process keeps a live timer per healthy rhiza per request, and Bun's test runner
      // does not exit.
      bound.cancel()
    }
  }))
}

export interface RuntimeHealth {
  mode: 'germinated' | 'degraded'
  failure?: GerminationFailure
  dormant: readonly { name: string, refusal: TranslatableRef }[]
  /** Kept apart from `dormant`: any one of these refuses all traffic (design §7). */
  enforcingBlocked: readonly string[]
  rhizas: readonly RhizaHealth[]
  /** Messages refused since boot while enforcingBlocked was non-empty (inventory §3 row 7). */
  blockedSinceBoot: number
}

/**
 * `sporesDirs`/`db` default to reading nothing extra, so `registry.dormant` alone still
 * answers when a caller has neither (mirrors listPlugins' own optional db).
 */
export async function aggregateRuntimeHealth(
  germination: Germination, sporesDirs: readonly string[] = [], db?: Db,
): Promise<RuntimeHealth> {
  if (germination.status !== 'germinated') {
    return {
      mode: 'degraded',
      ...(germination.status === 'degraded' ? { failure: germination.failure } : {}),
      dormant: [], enforcingBlocked: [], rhizas: [], blockedSinceBoot: 0,
    }
  }
  const { registry, admission } = germination.mycelium
  // Reuses /api/plugins' own reader (config/plugins.ts) rather than a second one: it already
  // carries the install row of a spore whose directory has gone, which registry.dormant cannot.
  const dormant = listPlugins(registry, sporesDirs, db)
    .filter((p): p is PluginInfo & { refusal: TranslatableRef } => p.state === 'dormant' && p.refusal !== undefined)
    .map((p) => ({ name: p.name, refusal: p.refusal }))
  return {
    mode: 'germinated',
    dormant,
    enforcingBlocked: registry.brokenEnforcing,
    rhizas: await aggregateHealth(registry),
    blockedSinceBoot: admission.blockedSinceBoot(),
  }
}
