import { readArray } from './api/read.ts'
import type { RhizaHealth, RuntimeHealth } from './api/types.ts'

/** The two runtime faults `/api/health` reports for a rhiza that germinated. */
export interface RhizaFault {
  state: 'degraded' | 'unreachable'
  detail?: string
}

/** One rule, three former call sites: a screen must not disagree with another about one rhiza. */
export function collapseHealth(state: string): 'degraded' | 'unreachable' {
  return state === 'degraded' ? 'degraded' : 'unreachable'
}

/**
 * What `/api/health` says about one plugin, or `undefined` while it answers healthy — and for
 * every plugin that is not a rhiza, since only rhizae are probed. Read by the plugins list and
 * a plugin's own page as well as the Overview: `/api/plugins` carries germination's verdict
 * alone, so those two called a rhiza answering HTTP 401 `Germinated` (finding F17).
 *
 * The state is collapsed rather than trusted: `aggregateHealth` returns the plugin's own answer
 * unvalidated, and a state no badge has a tone for throws on `TONE[state]`.
 */
export function faultOf(health: RuntimeHealth | null, name: string): RhizaFault | undefined {
  const found = (readArray<RhizaHealth>(health?.rhizas) ?? []).find((r) => r.rhiza === name)
  if (found === undefined || found.status.state === 'healthy') return undefined
  return {
    state: collapseHealth(found.status.state),
    ...(found.status.detail === undefined ? {} : { detail: found.status.detail }),
  }
}
