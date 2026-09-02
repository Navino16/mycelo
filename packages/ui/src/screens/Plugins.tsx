import { useEffect, useState } from 'react'
import { api } from '../api/client.ts'
import type { PluginGroups, SporeKind } from '../api/types.ts'
import { KindSection } from '../components/KindSection.tsx'
import { useT } from '../i18n.tsx'

const ORDER: readonly (SporeKind | 'unknown')[] = ['hypha', 'rhiza', 'enzyme', 'inhibitor', 'unknown']

export function Plugins(): React.JSX.Element {
  const t = useT()
  const [groups, setGroups] = useState<PluginGroups | null>(null)

  useEffect(() => {
    api.get<PluginGroups>('/api/plugins').then(setGroups, () => undefined)
  }, [])

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-medium">{t('plugins.title')}</h1>
      {groups !== null && ORDER.map((kind) => (
        <KindSection key={kind} kind={kind} plugins={groups[kind] ?? []} />
      ))}
    </div>
  )
}
