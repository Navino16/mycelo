import { useState } from 'react'
import { useT } from '../i18n.tsx'
import { EmptyState } from './EmptyState.tsx'
import { PluginRow } from './PluginRow.tsx'
import type { PluginDto, PluginState, SporeKind } from '../api/types.ts'
import type { StringKey } from '../../locales/en.ts'

/** design note 1b: state first, then name. Dormant surfaces without a filter. */
export const STATE_ORDER: readonly PluginState[] = ['dormant', 'pending', 'unknown', 'disabled', 'germinated']

export function sortStateFirst(plugins: readonly PluginDto[]): readonly PluginDto[] {
  return [...plugins].sort((a, b) => {
    const rank = STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state)
    return rank !== 0 ? rank : a.name.localeCompare(b.name)
  })
}

export function KindSection(
  { kind, plugins }: { kind: SporeKind | 'unknown', plugins: readonly PluginDto[] },
): React.JSX.Element {
  const t = useT()
  // Open by default: every rendered frame draws the accordion open, and a list closed on
  // arrival hides the dormant rows the state-first sort exists to surface.
  const [open, setOpen] = useState(true)
  const dormant = plugins.filter((p) => p.state === 'dormant').length
  const meta = dormant === 0
    ? t('kind.metaAllWell', { count: plugins.length })
    : t(dormant === 1 ? 'kind.metaOne' : 'kind.meta', { count: plugins.length, dormant })

  return (
    <section className="space-y-2" data-testid={`kind-section-${kind}`}>
      <h2 className="sticky top-0 z-[1] bg-surface md:static">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => { setOpen(!open) }}
          className="flex w-full flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-md bg-surface2 px-3 py-2 text-left"
        >
          <span className="text-title font-medium">{t(`kind.${kind}` as StringKey)}</span>
          {/* The separator and the subtitle sit in their own text nodes: sharing one node with
              the subtitle makes its rendered text "· channels", which no exact-text query can
              isolate as 'channels' — the brief's own draft did this and failed its own test. */}
          <span aria-hidden="true" className="text-meta-lg text-text/60">·</span>
          <span className="text-meta-lg text-text/60">{t(`kind.${kind}.subtitle` as StringKey)}</span>
          <span className="text-meta-lg text-text/50">{t(`kind.${kind}.lead` as StringKey)}</span>
          <span className="ml-auto font-mono text-meta-lg text-text/60">{meta}</span>
          <span aria-hidden="true" className="text-text/60">{open ? '⌄' : '›'}</span>
        </button>
      </h2>
      {open && (plugins.length === 0
        ? <EmptyState title={t('plugins.emptyTitle')} body={t('plugins.empty')} />
        : (
          <ul className="divide-y divide-line-soft rounded-lg border border-line">
            {sortStateFirst(plugins).map((plugin) => (
              <PluginRow key={plugin.name} plugin={plugin} />
            ))}
          </ul>
        ))}
    </section>
  )
}
