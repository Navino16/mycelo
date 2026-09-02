import { Link } from 'react-router'
import { readArray } from '../api/read.ts'
import { useHealth } from '../health.tsx'
import { useT } from '../i18n.tsx'
import type { RhizaHealth } from '../api/types.ts'

export function Overview(): React.JSX.Element {
  const t = useT()
  const { health } = useHealth()

  const dormant = readArray<{ name: string, reason: string }>(health?.dormant)
  const enforcingBlocked = readArray<string>(health?.enforcingBlocked)
  const rhizas = readArray<RhizaHealth>(health?.rhizas)
  // status is HealthStatus, not a bare string (api/types.ts): a 'degraded' or 'unreachable'
  // rhiza is a connector the operator needs to see, so both are grouped as one problem list.
  const degradedRhizas = rhizas?.filter((r) => r.status.state !== 'healthy') ?? []

  const unreadable = health !== null
    && (dormant === undefined || enforcingBlocked === undefined || rhizas === undefined)

  // mode is the gate, not just the arrays: germination.ts leaves them all [] on every failure
  // mode, so without this "Everything is germinated." rendered above the failure banner.
  // unreadable joins it: CriticalBanner never reports an unparseable shape as "nothing wrong".
  const allWell = health?.mode === 'germinated' && !unreadable
    && (dormant?.length ?? 0) === 0 && degradedRhizas.length === 0
    && (enforcingBlocked?.length ?? 0) === 0

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-medium">{t('overview.title')}</h1>

      {unreadable && (
        <div role="alert" className="rounded-lg border border-warn bg-warn-bg p-3">
          <p className="font-medium text-warn">{t('overview.unreadable')}</p>
        </div>
      )}

      {allWell && <p className="text-ok">{t('overview.allWell')}</p>}

      {/* != null, not !== undefined: a malformed 'failure: null' is not a shape health.ts
          (packages/core/src/supervision/health.ts:29) can send today, but '.message' on a
          bare null would crash the same way rhizas.filter did — cheap to close while here. */}
      {health?.mode === 'degraded' && health.failure != null && (
        <div className="rounded-lg border border-crit bg-crit-bg p-3">
          <p className="font-medium text-crit">{t('health.degraded.title')}</p>
          <p className="font-mono text-sm">{health.failure.message}</p>
        </div>
      )}

      {dormant !== undefined && dormant.length > 0 && (
        <section className="space-y-2">
          <h2 className="flex items-baseline gap-2">
            <span className="font-medium">{t('overview.plugins')}</span>
            <span className="text-sm text-text/60">
              {t('health.dormant', { count: dormant.length })}
            </span>
          </h2>
          <ul className="space-y-2">
            {dormant.map((d) => (
              <li key={d.name} className="rounded-lg border border-line p-3">
                <Link to={`/plugins/${d.name}`} className="font-mono">{d.name}</Link>
                <p className="text-sm text-text/70">{d.reason}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {degradedRhizas.length > 0 && (
        <section className="space-y-2">
          <h2 className="flex items-baseline gap-2">
            <span className="font-medium">{t('overview.systems')}</span>
            <span className="text-sm text-text/60">
              {t('health.rhizaDegraded', { count: degradedRhizas.length })}
            </span>
          </h2>
          <ul className="space-y-2">
            {degradedRhizas.map((r) => (
              <li key={r.rhiza} className="rounded-lg border border-warn p-3">
                <span className="font-mono">{r.rhiza}</span>
                <p className="text-sm text-text/70">{r.status.detail ?? r.status.state}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
