import { Link } from 'react-router'
import { useT } from '../i18n.tsx'
import { StateBadge } from './StateBadge.tsx'
import type { PluginDto, SporeKind } from '../api/types.ts'
import type { StringKey } from '../../locales/en.ts'

export function KindSection(
  { kind, plugins }: { kind: SporeKind | 'unknown', plugins: readonly PluginDto[] },
): React.JSX.Element {
  const t = useT()
  return (
    <section className="space-y-2" data-testid={`kind-section-${kind}`}>
      <h2 className="flex items-baseline gap-2">
        <span className="font-medium">{t(`kind.${kind}` as StringKey)}</span>
        {/* The separator and the subtitle sit in their own text nodes: sharing one node with
            the subtitle makes its rendered text "· channels", which no exact-text query can
            isolate as 'channels' — the brief's own draft did this and failed its own test. */}
        <span aria-hidden="true" className="text-sm text-text/60">·</span>
        <span className="text-sm text-text/60">{t(`kind.${kind}.subtitle` as StringKey)}</span>
      </h2>
      {plugins.length === 0
        ? <p className="text-sm text-text/60">{t('plugins.empty')}</p>
        : (
          <ul className="divide-y divide-line-soft rounded-lg border border-line">
            {plugins.map((plugin) => (
              <li key={plugin.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                <Link to={`/plugins/${plugin.name}`} className="font-mono">{plugin.name}</Link>
                <StateBadge state={plugin.state} />
                {/* design §7.4: an operator asked "where do I configure Signal?" needs this even for a
                    plugin nobody installed through a source. */}
                <span className="text-xs text-text/60">
                  {plugin.source ?? t('plugins.source.local')}
                  {plugin.strain !== undefined && ` · ${plugin.strain}`}
                </span>
                {plugin.reason !== undefined && (
                  <p className="w-full text-sm text-text/70">{plugin.reason}</p>
                )}
              </li>
            ))}
          </ul>
        )}
    </section>
  )
}
