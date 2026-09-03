import { Link } from 'react-router'
import { useT } from '../i18n.tsx'
import { kindLabel } from '../kinds.ts'
import { Dot } from './Dot.tsx'
import { TONE_CLASSES } from './tone.ts'
import type { SporeKind } from '../api/types.ts'
import type { StringKey } from '../../locales/en.ts'

export interface AttentionRow {
  name: string
  kind?: SporeKind
  /** 'dormant' for a plugin, 'unreachable'/'degraded' for a rhiza. */
  state: 'dormant' | 'degraded' | 'unreachable'
  reason: string
  action?: { to: string, label: string }
}

const LABEL: Record<AttentionRow['state'], StringKey> = {
  dormant: 'state.dormant',
  degraded: 'health.pill.degraded',
  unreachable: 'state.unreachable',
}

// R1: crit is the mute bot's alone, so every row here — dormant plugin or silent system — is amber.
const COLUMNS = 'md:grid md:grid-cols-[minmax(0,1fr)_7rem_minmax(0,2fr)_9rem] md:items-center md:gap-4'

function StateWord({ state }: { state: AttentionRow['state'] }): React.JSX.Element {
  const t = useT()
  const { text, bg } = TONE_CLASSES.warn
  return (
    <span
      data-tone="warn"
      className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-meta font-medium ${text} ${bg}`}
    >
      <Dot tone="warn" />
      {t(LABEL[state])}
    </span>
  )
}

/** 1a's `Needs attention` table: one row per dormant plugin and per connected system that is down. */
export function AttentionTable({ rows }: { rows: readonly AttentionRow[] }): React.JSX.Element {
  const t = useT()
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <div
        className={`hidden border-b border-line px-4 py-2 text-meta uppercase tracking-wide text-text/60 ${COLUMNS}`}
      >
        <span>{t('attention.name')}</span>
        <span>{t('attention.state')}</span>
        <span>{t('attention.reason')}</span>
        <span />
      </div>
      <ul className="divide-y divide-line">
        {rows.map((row) => (
          <li key={`${row.state}:${row.name}`} className={`grid gap-2 px-4 py-3 ${COLUMNS}`}>
            <div className="min-w-0">
              <Link to={`/plugins/${row.name}`} className="font-mono text-body">{row.name}</Link>
              {row.kind !== undefined && (
                <p className="text-meta text-text/60">{kindLabel(t, row.kind)}</p>
              )}
            </div>
            <StateWord state={row.state} />
            <p className="text-body text-text/70">{row.reason}</p>
            {row.action === undefined
              ? <span />
              : (
                  <Link
                    to={row.action.to}
                    className="w-fit rounded-md border border-line px-3 py-1.5 text-meta-lg"
                  >
                    {row.action.label}
                  </Link>
                )}
          </li>
        ))}
      </ul>
    </div>
  )
}
