import type { HealthState, HealthStatus } from '../context.js'

const HEALTH_STATES: readonly HealthState[] = ['healthy', 'degraded', 'unreachable']

/**
 * Shared by the rhiza and hypha kits. Neither aggregate re-validates what the plugin returned,
 * so a malformed `checkedAt` reaches the SPA as JSON with no signal anywhere else.
 * Returns nothing when the hook is absent: `Hypha.health` is optional, unlike `Rhiza.health`.
 */
export async function healthFailures(instance: { health?: () => Promise<HealthStatus> }): Promise<string[]> {
  if (typeof instance.health !== 'function') return []
  const failures: string[] = []
  try {
    const health = await instance.health()
    if (typeof health !== 'object' || health === null) {
      failures.push(`health() returned ${String(health)}, expected a HealthStatus`)
    } else {
      if (!HEALTH_STATES.includes(health.state)) {
        failures.push(
          `health() reported state '${String(health.state)}', expected one of ${HEALTH_STATES.join(', ')}`,
        )
      }
      if (!(health.checkedAt instanceof Date) || Number.isNaN(health.checkedAt.getTime())) {
        failures.push('health() returned no valid checkedAt date')
      }
    }
  } catch (e) {
    // health() reporting a problem is its job; throwing is not. The core calls it
    // on a schedule and a throw would surface as an unhandled rejection.
    failures.push(`health() threw instead of reporting a degraded state: ${(e as Error).message}`)
  }
  return failures
}
