import { TONE_CLASSES } from './tone.ts'
import type { Tone } from './tone.ts'

export interface Segment { tone: Tone, value: number, label: string }

/** Three divs and no shadcn Progress — the design's own named exception (note 1a), because a
 * Progress is one value and this is a proportion of several. */
export function ProportionBar({ segments }: { segments: readonly Segment[] }): React.JSX.Element {
  const total = segments.reduce((sum, s) => sum + s.value, 0)
  return (
    <div className="flex h-2 overflow-hidden rounded-full bg-line-soft">
      {total > 0 && segments.filter((s) => s.value > 0).map((s) => (
        <div
          key={s.label}
          data-segment={s.label}
          title={s.label}
          style={{ width: `${String((s.value / total) * 100)}%` }}
          className={TONE_CLASSES[s.tone].fill}
        />
      ))}
    </div>
  )
}
