import { useT } from '../i18n.tsx'
import { SCOPE_SENTENCE } from '../scopes.ts'
import type { SporeDemands } from '../api/types.ts'

export function DemandsList({ demands }: { demands: SporeDemands }): React.JSX.Element {
  const t = useT()
  const empty = demands.requires.length === 0 && demands.scopes.length === 0
    && demands.externals.length === 0
    && demands.commands.every((c) => c.capabilities.length === 0)
  if (empty) return <p className="text-sm text-text/70">{t('demands.none')}</p>

  return (
    <div className="space-y-4">
      {demands.requires.length > 0 && (
        <section>
          <h3 className="text-sm font-medium">{t('demands.requires')}</h3>
          <ul className="mt-1 space-y-1 text-sm">
            {demands.requires.map((r) => (
              <li key={r.targets.join('|')} className="font-mono">
                {r.anyOf && <span className="mr-1 font-sans text-text/60">{t('demands.anyOf')}</span>}
                {r.targets.join(' · ')}
                {r.optional && <span className="ml-2 font-sans text-text/60">({t('demands.optional')})</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {demands.scopes.length > 0 && (
        <section>
          <h3 className="text-sm font-medium">{t('demands.scopes')}</h3>
          <ul className="mt-1 space-y-1 text-sm">
            {demands.scopes.map((s) => {
              const key = SCOPE_SENTENCE[s]
              return <li key={s}>{key === undefined ? s : t(key)}</li>
            })}
          </ul>
        </section>
      )}
      {demands.externals.length > 0 && (
        <section>
          <h3 className="text-sm font-medium">{t('demands.externals')}</h3>
          <ul className="mt-1 space-y-1 font-mono text-sm">
            {demands.externals.map((e) => <li key={e}>{e}</li>)}
          </ul>
        </section>
      )}
      {demands.commands.some((c) => c.capabilities.length > 0) && (
        <section>
          <h3 className="text-sm font-medium">{t('demands.capabilities')}</h3>
          <ul className="mt-1 space-y-1 text-sm">
            {demands.commands.filter((c) => c.capabilities.length > 0).map((c) => (
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
