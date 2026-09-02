import { TONE_CLASSES } from './tone.ts'
import type { Tone } from './tone.ts'

// Re-exported so every consumer takes `Tone` from the primitive it is already importing.
export type { Tone } from './tone.ts'

/** Decorative by construction (design note 1b): the word beside it carries the meaning. */
export function Dot({ tone }: { tone: Tone }): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-2 shrink-0 rounded-full ${TONE_CLASSES[tone].fill}`}
    />
  )
}
