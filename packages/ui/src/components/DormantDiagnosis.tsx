import { Link } from 'react-router'
import { useT } from '../i18n.tsx'
import { TONE_CLASSES } from './tone.ts'
import type { StringKey } from '../../locales/en.ts'

export interface Diagnosis { title: StringKey, action?: { to: string, label: StringKey } }

/**
 * One `reason` string per cause; the first match wins. A command collision aborts the whole
 * germination, so "already claimed by" (anastomoses.ts) never reaches one plugin's `reason`.
 * Exported: the Overview's attention rows take their action from the same classifier.
 */
export function diagnose(name: string, reason: string): Diagnosis {
  if (/configuration rejected|configuration is incomplete/i.test(reason)) {
    return { title: 'dormant.config', action: { to: `/plugins/${name}/settings`, label: 'dormant.fixConfig' } }
  }
  if (/septum|range|version/i.test(reason)) return { title: 'dormant.version' }
  if (/not installed|requires|any_of|dependency/i.test(reason)) return { title: 'dormant.dependency' }
  if (/already claimed/i.test(reason)) {
    return { title: 'dormant.collision', action: { to: '/plugins', label: 'dormant.setAlias' } }
  }
  return { title: 'dormant.other' }
}

export function DormantDiagnosis({ name, reason }: { name: string, reason: string }): React.JSX.Element {
  const t = useT()
  const { title, action } = diagnose(name, reason)
  // Amber, never crit: design note 2j gives red to the mute bot alone, and a dormant plugin
  // is one plugin's failure rather than a substrate that refuses every message.
  const { text, bg, border } = TONE_CLASSES.warn
  return (
    <div data-diagnosis className={`space-y-2 rounded-xl border p-4 ${border} ${bg}`}>
      <p className={`text-title font-medium ${text}`}>{t(title)}</p>
      <p className="rounded-md bg-bg/40 p-3 font-mono text-body">{reason}</p>
      {action !== undefined && (
        <Link to={action.to} className="inline-block text-body text-accent underline">
          {t(action.label)}
        </Link>
      )}
    </div>
  )
}
