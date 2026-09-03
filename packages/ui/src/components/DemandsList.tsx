import { readArray } from '../api/read.ts'
import { useT } from '../i18n.tsx'
import { SCOPE_SENTENCE } from '../scopes.ts'
import { EmptyState } from './EmptyState.tsx'
import type { CommandCapabilityDto, RequirementDto, SporeDemands } from '../api/types.ts'

export function DemandsList({ demands }: { demands: SporeDemands }): React.JSX.Element {
  const t = useT()
  // Each field is API-boundary data (task 7's guard rule), guarded independently: the parent
  // object existing says nothing about any one of its own arrays being an array.
  const requires = readArray<RequirementDto>(demands.requires) ?? []
  const scopes = readArray<string>(demands.scopes) ?? []
  const externals = readArray<string>(demands.externals) ?? []
  const commands = readArray<CommandCapabilityDto>(demands.commands) ?? []

  const empty = requires.length === 0 && scopes.length === 0
    && externals.length === 0
    && commands.every((c) => c.capabilities.length === 0)
  if (empty) return <EmptyState title={t('demands.noneTitle')} body={t('demands.none')} />

  return (
    <div className="space-y-4">
      {requires.length > 0 && (
        <section>
          <h3 className="text-sm font-medium">{t('demands.requires')}</h3>
          <ul className="mt-1 space-y-1 text-sm">
            {requires.map((r) => (
              <li key={r.targets.join('|')} className="font-mono">
                {r.anyOf && <span className="mr-1 font-sans text-text/60">{t('demands.anyOf')}</span>}
                {r.targets.join(' · ')}
                {r.optional && <span className="ml-2 font-sans text-text/60">({t('demands.optional')})</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {scopes.length > 0 && (
        <section>
          <h3 className="text-sm font-medium">{t('demands.scopes')}</h3>
          <ul className="mt-1 space-y-1 text-sm">
            {scopes.map((s) => {
              const key = SCOPE_SENTENCE[s]
              return <li key={s}>{key === undefined ? s : t(key)}</li>
            })}
          </ul>
        </section>
      )}
      {externals.length > 0 && (
        <section>
          <h3 className="text-sm font-medium">{t('demands.externals')}</h3>
          <ul className="mt-1 space-y-1 font-mono text-sm">
            {externals.map((e) => <li key={e}>{e}</li>)}
          </ul>
        </section>
      )}
      {commands.some((c) => c.capabilities.length > 0) && (
        <section>
          <h3 className="text-sm font-medium">{t('demands.capabilities')}</h3>
          <ul className="mt-1 space-y-1 text-sm">
            {commands.filter((c) => c.capabilities.length > 0).map((c) => (
              <li key={c.name}>
                <span className="font-mono">{c.name}</span>
                <span className="text-text/70"> — {c.capabilities.join(', ')}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
