export type Tone = 'ok' | 'warn' | 'crit' | 'idle'

export interface ToneClasses {
  text: string
  /** The tint behind a badge or a pill. */
  bg: string
  /** A solid fill: a dot, a proportion segment. */
  fill: string
  border: string
}

/**
 * The one tone→class table of the whole SPA. Literals per tone, never `bg-${tone}`: Tailwind
 * extracts class names from source text and would emit none of these. `crit` belongs to the
 * mute bot alone (design note 2j) — nothing else may reach for it.
 */
export const TONE_CLASSES: Record<Tone, ToneClasses> = {
  ok: { text: 'text-ok', bg: 'bg-ok-bg', fill: 'bg-ok', border: 'border-ok/40' },
  warn: { text: 'text-warn', bg: 'bg-warn-bg', fill: 'bg-warn', border: 'border-warn/40' },
  crit: { text: 'text-crit', bg: 'bg-crit-bg', fill: 'bg-crit', border: 'border-crit/40' },
  idle: { text: 'text-idle', bg: 'bg-idle-bg', fill: 'bg-idle', border: 'border-line' },
}
