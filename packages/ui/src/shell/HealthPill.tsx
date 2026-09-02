import { Dot } from '../components/Dot.tsx'
import { TONE_CLASSES } from '../components/tone.ts'
import { readArray } from '../api/read.ts'
import { useHealth } from '../health.tsx'
import { useT } from '../i18n.tsx'
import type { Tone } from '../components/tone.ts'
import type { RhizaHealth, RuntimeHealth } from '../api/types.ts'
import type { StringKey } from '../../locales/en.ts'

export type PillState = 'healthy' | 'degraded' | 'mute' | 'unreadable' | 'offline'

// crit is the mute bot's alone (design note 2j): a substrate that will not answer is amber.
const TONE: Record<PillState, Tone> = {
  healthy: 'ok', degraded: 'warn', mute: 'crit', unreadable: 'warn', offline: 'warn',
}

const LABEL: Record<PillState, StringKey> = {
  healthy: 'health.pill.healthy',
  degraded: 'health.pill.degraded',
  mute: 'health.pill.mute',
  unreadable: 'health.pill.unreadable',
  offline: 'health.pill.offline',
}

/** Counts a health payload's failing connected systems, guarding a malformed `rhizas`. */
export function countUnhealthyRhizas(health: RuntimeHealth | null): number {
  const rhizas = readArray<RhizaHealth>(health?.rhizas) ?? []
  return rhizas.filter((r) => r.status?.state !== 'healthy').length
}

/**
 * CriticalBanner's four causes, exported so the pill and task 16's takeover decide identically.
 * A failed poll and a payload that cannot be read stay two states: the metaphor never replaces
 * the information.
 */
export function healthPillState(
  health: RuntimeHealth | null, error: boolean,
): { state: PillState, issues: number } {
  if (error) return { state: 'offline', issues: 0 }
  if (health === null) return { state: 'unreadable', issues: 0 }
  const blocked = readArray<string>(health.enforcingBlocked)
  const dormant = readArray<{ name: string, reason: string }>(health.dormant)
  const rhizas = readArray<RhizaHealth>(health.rhizas)
  // Absent is not empty (CriticalBanner): a payload with no enforcingBlocked cannot be read
  // as "nothing is blocked", or a mute bot reports healthy.
  if (blocked === undefined || dormant === undefined || rhizas === undefined) {
    return { state: 'unreadable', issues: 0 }
  }
  const issues = dormant.length + rhizas.filter((r) => r.status?.state !== 'healthy').length
  if (blocked.length > 0) return { state: 'mute', issues }
  if (health.mode === 'degraded' || issues > 0) return { state: 'degraded', issues }
  return { state: 'healthy', issues: 0 }
}

function pillLabel(t: (k: StringKey, p?: Record<string, string | number>) => string,
  state: PillState, issues: number): string {
  if (state !== 'degraded' || issues === 0) return t(LABEL[state])
  return issues === 1
    ? t('health.pill.degradedOne', { count: issues })
    : t('health.pill.degradedCount', { count: issues })
}

export function HealthPill(): React.JSX.Element | null {
  const t = useT()
  const { health, error } = useHealth()
  if (health === null && !error) return null
  const { state, issues } = healthPillState(health, error)
  const tone = TONE[state]
  const { text, bg } = TONE_CLASSES[tone]
  return (
    <span
      role="status"
      data-tone={tone}
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-meta-lg font-medium ${text} ${bg}`}
    >
      <Dot tone={tone} />
      {pillLabel(t, state, issues)}
    </span>
  )
}
