import { useEffect, useState } from 'react'
import { api } from '../api/client.ts'
import type { PluginGroups, SporeKind } from '../api/types.ts'
import { KindSection } from '../components/KindSection.tsx'
import { useT } from '../i18n.tsx'

const ORDER: readonly (SporeKind | 'unknown')[] = ['hypha', 'rhiza', 'enzyme', 'inhibitor', 'unknown']

export function Plugins(): React.JSX.Element {
  const t = useT()
  const [groups, setGroups] = useState<PluginGroups | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    api.get<PluginGroups>('/api/plugins').then(
      (g) => { setGroups(g); setError(false) },
      () => { setError(true) },
    )
  }, [])

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-medium">{t('plugins.title')}</h1>
      {error && <p role="alert" className="text-sm text-crit">{t('error.generic')}</p>}
      {groups !== null && ORDER.map((kind) => (
        <KindSection key={kind} kind={kind} plugins={groups[kind] ?? []} />
      ))}
    </div>
  )
}
