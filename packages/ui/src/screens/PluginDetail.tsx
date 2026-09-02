import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { api } from '../api/client.ts'
import type { PluginDetailDto } from '../api/types.ts'
import { DemandsList } from '../components/DemandsList.tsx'
import { DormantDiagnosis } from '../components/DormantDiagnosis.tsx'
import { StateBadge } from '../components/StateBadge.tsx'
import { useT } from '../i18n.tsx'

// Task 7's guard rule (health?.rhizas.filter was a real production bug): a bare `.map()` on
// an optional array trusts the API shape past what the fetch actually returned.
function readArray<T>(value: unknown): readonly T[] | undefined {
  return Array.isArray(value) ? value as readonly T[] : undefined
}

export function PluginDetail(): React.JSX.Element {
  const t = useT()
  const { name = '' } = useParams()
  const [plugin, setPlugin] = useState<PluginDetailDto | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    api.get<PluginDetailDto>(`/api/plugins/${name}`).then(
      (v) => { setPlugin(v); setError(false) },
      () => { setError(true) },
    )
  }, [name])

  const commands = readArray<string>(plugin?.commands)
  const mounted = readArray<string>(plugin?.mounted)

  return (
    <div className="space-y-6">
      {error && <p role="alert" className="text-sm text-crit">{t('error.generic')}</p>}

      {plugin !== null && (
        <>
          <header className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-xl">{plugin.name}</h1>
            <StateBadge state={plugin.state} />
            {plugin.strain !== undefined && <span className="text-sm text-text/60">{plugin.strain}</span>}
            {plugin.source !== undefined
              ? <span className="text-sm text-text/60">{plugin.source}</span>
              : <span className="text-sm text-text/60">{t('plugins.source.local')}</span>}
          </header>

          {plugin.state === 'dormant' && plugin.reason !== undefined && (
            <DormantDiagnosis name={plugin.name} reason={plugin.reason} />
          )}

          {plugin.demands !== undefined && (
            <section className="space-y-2">
              <h2 className="font-medium">{t('detail.declared')}</h2>
              <DemandsList demands={plugin.demands} />
            </section>
          )}

          {mounted !== undefined && (
            <section className="space-y-2">
              <h2 className="font-medium">{t('detail.mounted')}</h2>
              <ul className="space-y-1 font-mono text-sm">
                {mounted.map((s) => <li key={s}>{s}</li>)}
              </ul>
            </section>
          )}

          {commands !== undefined && commands.length > 0 && (
            <section className="space-y-2">
              <h2 className="font-medium">{t('detail.commands')}</h2>
              <ul className="space-y-1 font-mono text-sm">
                {commands.map((c) => <li key={c}>{c}</li>)}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}
