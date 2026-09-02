import { Link } from 'react-router'
import { useHealth } from '../health.tsx'
import { useT } from '../i18n.tsx'

export function Overview(): React.JSX.Element {
  const t = useT()
  const { health } = useHealth()

  // status is HealthStatus, not a bare string (api/types.ts): a 'degraded' or 'unreachable'
  // rhiza is a connector the operator needs to see, so both are grouped as one problem list.
  const degradedRhizas = health?.rhizas.filter((r) => r.status.state !== 'healthy') ?? []
  // mode is the gate, not just the three arrays: germination.ts leaves dormant/enforcingBlocked/
  // rhizas all [] on every failure mode, so without this "Everything is germinated." rendered
  // directly above the crit-styled failure banner.
  const allWell = health?.mode === 'germinated' && health.dormant.length === 0
    && degradedRhizas.length === 0 && health.enforcingBlocked.length === 0

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-medium">{t('overview.title')}</h1>

      {allWell && <p className="text-ok">{t('overview.allWell')}</p>}

      {health?.mode === 'degraded' && health.failure !== undefined && (
        <div className="rounded-lg border border-crit bg-crit-bg p-3">
          <p className="font-medium text-crit">{t('health.degraded.title')}</p>
          <p className="font-mono text-sm">{health.failure.message}</p>
        </div>
      )}

      {health !== null && health.dormant.length > 0 && (
        <section className="space-y-2">
          <h2 className="flex items-baseline gap-2">
            <span className="font-medium">{t('overview.plugins')}</span>
            <span className="text-sm text-text/60">
              {t('health.dormant', { count: health.dormant.length })}
            </span>
          </h2>
          <ul className="space-y-2">
            {health.dormant.map((d) => (
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
