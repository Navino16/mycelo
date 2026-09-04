import { TONE_CLASSES } from './tone.ts'
import type { Tone } from './tone.ts'

export function Chip(
  { label, count, tone = 'idle', active = false, onClick }: {
    label: string, count?: number, tone?: Tone, active?: boolean, onClick?: () => void,
  },
): React.JSX.Element {
  const { text, border } = TONE_CLASSES[tone]
  const shape = [
    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-meta-lg',
    text, border, active ? 'bg-surface2' : '',
  ].join(' ')
  const body = (
    <>
      <span>{label}</span>
      {count !== undefined && <span className="font-mono">{String(count)}</span>}
    </>
  )
  if (onClick === undefined) return <span data-tone={tone} className={shape}>{body}</span>
  return (
    <button type="button" data-tone={tone} aria-pressed={active} onClick={onClick} className={shape}>
      {body}
    </button>
  )
}
