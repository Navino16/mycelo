import { Link } from 'react-router'
import { TONE_CLASSES } from './tone.ts'
import type { Tone } from './tone.ts'

/**
 * `value` undefined renders nothing where the number would be: a count nobody confirmed is
 * withheld, and a marker in its place is one more thing to learn the meaning of.
 */
export function Tile(
  { label, value, note, noteTone = 'idle', to }: {
    label: string, value?: string, note?: string, noteTone?: Tone, to?: string,
  },
): React.JSX.Element {
  const body = (
    <>
      <p className="text-meta uppercase tracking-wide text-text/60">{label}</p>
      {value !== undefined && <p className="text-hero font-medium">{value}</p>}
      {note !== undefined && <p className={`text-meta-lg ${TONE_CLASSES[noteTone].text}`}>{note}</p>}
    </>
  )
  const shape = 'block space-y-1 rounded-xl border border-line bg-surface p-3'
  return to === undefined ? <div className={shape}>{body}</div> : <Link to={to} className={shape}>{body}</Link>
}
