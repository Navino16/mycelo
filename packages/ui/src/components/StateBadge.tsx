import { useT } from '../i18n.tsx'
import type { PluginState } from '../api/types.ts'
import type { StringKey } from '../../locales/en.ts'

const TONE: Record<PluginState, string> = {
  germinated: 'text-ok bg-ok-bg',
  dormant: 'text-crit bg-crit-bg',
  // A disabled plugin is a choice, not a fault — phase 5's reason for not calling it dormant.
  disabled: 'text-idle bg-idle-bg',
  pending: 'text-warn bg-warn-bg',
  unknown: 'text-warn bg-warn-bg',
}

export function StateBadge({ state }: { state: PluginState }): React.JSX.Element {
  const t = useT()
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs ${TONE[state]}`}>
      {t(`state.${state}` as StringKey)}
    </span>
  )
}
