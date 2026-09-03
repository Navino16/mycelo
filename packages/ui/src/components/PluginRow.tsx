import { Link } from 'react-router'
import { useT } from '../i18n.tsx'
import { Dot } from './Dot.tsx'
import { StateBadge, toneOf } from './StateBadge.tsx'
import { TONE_CLASSES } from './tone.ts'
import type { PluginDto } from '../api/types.ts'

/**
 * One row of 1b: five desktop columns, one stacked block on a phone. A grid rather than a
 * `<table>` so both layouts stay one component — the mobile frame is not a narrow table.
 */
export function PluginRow({ plugin }: { plugin: PluginDto }): React.JSX.Element {
  const t = useT()
  const tone = toneOf(plugin.state)
  return (
    <li className="grid items-baseline gap-x-3 gap-y-1 p-3 md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_6rem_8rem_minmax(0,2fr)]">
      <span className="flex min-w-0 items-center gap-2">
        <Dot tone={tone} />
        <Link to={`/plugins/${plugin.name}`} data-testid="plugin-name" className="truncate font-mono">
          {plugin.name}
        </Link>
      </span>
      <span className="min-w-0">
        {plugin.description !== undefined && (
          <span className="block truncate text-body text-text/70">{plugin.description}</span>
        )}
        {/* design §7.4: an operator asked "where do I configure Signal?" needs this even for a
            plugin nobody installed through a source. */}
        <span className="block truncate text-meta text-text/60">
          {plugin.source ?? t('plugins.source.local')}
        </span>
      </span>
      <span className="font-mono text-meta-lg text-text/60">{plugin.strain ?? ''}</span>
      <span className="justify-self-start"><StateBadge state={plugin.state} /></span>
      {/* R7: the cause sits on the row, never behind a hover. */}
      {plugin.reason !== undefined && (
        <span className={`text-body md:text-right ${TONE_CLASSES[tone].text}`}>{plugin.reason}</span>
      )}
    </li>
  )
}
