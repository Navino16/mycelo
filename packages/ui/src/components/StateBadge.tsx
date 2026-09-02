import { Dot } from './Dot.tsx'
import { TONE_CLASSES } from './tone.ts'
import { useT } from '../i18n.tsx'
import type { Tone } from './tone.ts'
import type { PluginState } from '../api/types.ts'
import type { StringKey } from '../../locales/en.ts'

// design note 2j: crit belongs to the mute bot alone, so a dormant plugin is amber. `pending`
// and `unknown` are the SPA's own states, which no artboard draws (inventory §1.5).
const TONE: Record<PluginState, Tone> = {
  germinated: 'ok',
  dormant: 'warn',
  // A disabled plugin is a choice, not a fault — phase 5's reason for not calling it dormant.
  disabled: 'idle',
  pending: 'warn',
  unknown: 'idle',
}

export function toneOf(state: PluginState): Tone { return TONE[state] }

export function StateBadge({ state }: { state: PluginState }): React.JSX.Element {
  const t = useT()
  const tone = TONE[state]
  const { text, bg } = TONE_CLASSES[tone]
  return (
    <span
      data-tone={tone}
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-meta font-medium ${text} ${bg}`}
    >
      <Dot tone={tone} />
      {t(`state.${state}` as StringKey)}
    </span>
  )
}
