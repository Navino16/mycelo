import type { HealthStatus, PluginInfo, RhizaHealth, TranslatableRef } from '@mycelo/septum'
import type { Germination, GerminationFailure } from '../boot/state.js'
import { listPlugins } from '../config/plugins.js'
import type { GerminatedHypha, Registry } from '../germination/registry.js'
import type { Db } from '../persistence/db.js'
import { describeThrown } from '../support/thrown.js'
import type { Translator } from '../i18n/translator.js'

/**
 * spec §11: a rhiza that never answers is unreachable, exactly like one that throws. Without the
 * bound, one plugin's hanging `health()` hangs `/api/health` and `/api/graph` — the two screens an
 * operator opens *because* something is wrong (9.5 review, M8).
 */
export const HEALTH_TIMEOUT_MS = 5_000

function unreachable(detail: string): HealthStatus {
  return { state: 'unreachable', detail, checkedAt: new Date() }
}

/**
 * Rejects rather than resolving, so one `catch` covers a throw, a rejection and a hang alike.
 * This detail is core-authored, unlike a plugin's own, so it renders via `translator`/`locale`
 * when given; the plugin-facing mycelium `health.read` call has no request locale to pass.
 */
function afterTimeout(
  ms: number, translator?: Translator, locale?: string,
): { promise: Promise<never>, cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined
  const promise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const detail = translator === undefined || locale === undefined
        ? `health() did not answer within ${String(ms)}ms`
        : translator.translate('core', 'health.timeout', locale, { ms })
      reject(new Error(detail))
    }, ms)
  })
  return { promise, cancel: () => { if (timer !== undefined) clearTimeout(timer) } }
}

/** A throw, a rejection and a hang all land on the same `catch`, so all three read unreachable. */
async function statusOf(
  call: () => Promise<HealthStatus>, timeoutMs: number, translator?: Translator, locale?: string,
): Promise<HealthStatus> {
  const bound = afterTimeout(timeoutMs, translator, locale)
  try {
    return await Promise.race([call(), bound.promise])
  } catch (e) {
    return unreachable(describeThrown(e))
  } finally {
    // Or the process keeps a live timer per healthy plugin per request, and Bun's test runner
    // does not exit.
    bound.cancel()
  }
}

export async function aggregateHealth(
  registry: Registry, timeoutMs: number = HEALTH_TIMEOUT_MS, translator?: Translator, locale?: string,
): Promise<readonly RhizaHealth[]> {
  return Promise.all(registry.rhizas.map(async (r) => ({
    rhiza: r.name,
    status: await statusOf(() => r.instance.health(), timeoutMs, translator, locale),
  })))
}

export interface HyphaHealth {
  hypha: string
  status: HealthStatus
}

function declaresHealth(
  h: GerminatedHypha,
): h is GerminatedHypha & { instance: { health: () => Promise<HealthStatus> } } {
  return typeof h.instance.health === 'function'
}

/** Only hyphae that declare `health` are reported: the rest are unchanged from today (task 4). */
export async function aggregateHyphaHealth(
  registry: Registry, timeoutMs: number = HEALTH_TIMEOUT_MS, translator?: Translator, locale?: string,
): Promise<readonly HyphaHealth[]> {
  return Promise.all(registry.hyphae.filter(declaresHealth).map(async (h) => ({
    hypha: h.name,
    status: await statusOf(() => h.instance.health(), timeoutMs, translator, locale),
  })))
}

export interface RuntimeHealth {
  mode: 'germinated' | 'degraded'
  failure?: GerminationFailure
  dormant: readonly { name: string, refusal: TranslatableRef }[]
  /** Kept apart from `dormant`: any one of these refuses all traffic (design §7). */
  enforcingBlocked: readonly string[]
  rhizas: readonly RhizaHealth[]
  /** Only hyphae that declare `health`; a hanging one lands here as unreachable, never omitted. */
  hyphae: readonly HyphaHealth[]
  /** Messages refused since boot while enforcingBlocked was non-empty (inventory §3 row 7). */
  blockedSinceBoot: number
}

/**
 * `sporesDirs`/`db` default to reading nothing extra, so `registry.dormant` alone still
 * answers when a caller has neither (mirrors listPlugins' own optional db). `translator`/`locale`
 * render a timed-out rhiza's detail at the caller's locale (task 4, phase 9.75A).
 */
export async function aggregateRuntimeHealth(
  germination: Germination, sporesDirs: readonly string[] = [], db?: Db,
  translator?: Translator, locale?: string,
): Promise<RuntimeHealth> {
  if (germination.status !== 'germinated') {
    return {
      mode: 'degraded',
      ...(germination.status === 'degraded' ? { failure: germination.failure } : {}),
      dormant: [], enforcingBlocked: [], rhizas: [], hyphae: [], blockedSinceBoot: 0,
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
    rhizas: await aggregateHealth(registry, undefined, translator, locale),
    hyphae: await aggregateHyphaHealth(registry, undefined, translator, locale),
    blockedSinceBoot: admission.blockedSinceBoot(),
  }
}
