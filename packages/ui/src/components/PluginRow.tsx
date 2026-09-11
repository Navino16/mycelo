import { Link } from 'react-router'
import { useHealth } from '../health.tsx'
import { useT } from '../i18n.tsx'
import { Dot } from './Dot.tsx'
import { StateBadge, toneOf } from './StateBadge.tsx'
import { TONE_CLASSES } from './tone.ts'
import { faultOf } from '../rhizaHealth.ts'
import type { PluginDto } from '../api/types.ts'

/**
 * One row of 1b: five desktop columns, three lines plus a chevron on a phone. A grid rather
 * than a `<table>` so both layouts stay one component — the mobile frame is not a narrow table.
 */
export function PluginRow({ plugin }: { plugin: PluginDto }): React.JSX.Element {
  const t = useT()
  const { health } = useHealth()
  // finding F17: /api/plugins answers germination's verdict alone, so a rhiza that germinated
  // and then stopped answering read `Germinated` here while the Overview had its 401.
  const fault = faultOf(health, plugin.name)
  const state = fault?.state ?? plugin.state
  const note = plugin.reason ?? fault?.detail
  const tone = toneOf(state)
  return (
    <li className="relative grid items-baseline gap-x-3 gap-y-1 p-3 md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_6rem_8rem_minmax(0,2fr)]">
      <span className="flex min-w-0 items-center gap-2">
        <Dot tone={tone} />
        <Link to={`/plugins/${plugin.name}`} data-testid="plugin-name" className="truncate font-mono">
          {plugin.name}
        </Link>
        {/* Row 54: on a phone the artboard right-aligns the version against the name rather
            than giving it a column of its own. At md the column returns and this is empty. */}
        <span className="ml-auto font-mono text-meta-lg text-text/60 md:hidden">
          {plugin.strain ?? ''}
        </span>
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
      <span className="hidden font-mono text-meta-lg text-text/60 md:block">{plugin.strain ?? ''}</span>
      {/* A disabled/pending/unknown plugin carries no note (no refusal to translate), so the
          badge is the only tone signal on a phone and must not hide — the note line and the
          badge line never both need the row's third slot. */}
      <span
        data-testid="plugin-state"
        className={`justify-self-start ${note === undefined ? '' : 'hidden md:block'}`}
      >
        <StateBadge state={state} />
      </span>
      {/* R7: the cause sits on the row, never behind a hover — clamped like the two columns
          beside it, since a real Zod refusal runs to 200 characters and 1b's model is a note
          with the full text on the diagnosis card the name links to. */}
      {note !== undefined && (
        <span className={`truncate text-body md:text-right ${TONE_CLASSES[tone].text}`}>
          {note}
        </span>
      )}
      {/* Row 54: the artboard draws a chevron on every phone row; the desktop grid needs none. */}
      <span
        data-testid="plugin-chevron"
        aria-hidden="true"
        className="absolute right-3 top-1/2 -translate-y-1/2 text-text/40 md:hidden"
      >
        ›
      </span>
    </li>
  )
}
