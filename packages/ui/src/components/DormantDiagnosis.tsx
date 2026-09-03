import { Link } from 'react-router'
import { useT } from '../i18n.tsx'
import type { StringKey } from '../../locales/en.ts'

export interface Diagnosis { title: StringKey, action?: { to: string, label: StringKey } }

/**
 * One `reason` string per cause; the first match wins. The per-plugin duplicate-name reason is
 * "already claimed by" (anastomoses.ts) — a command collision aborts the whole germination
 * instead of reaching a single plugin's `reason`, so that message never appears here.
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
  return (
    <div className="space-y-2 rounded-lg border border-crit bg-crit-bg p-3">
      <p className="font-medium text-crit">{t(title)}</p>
      <p className="font-mono text-sm">{reason}</p>
      {action !== undefined && (
        <Link to={action.to} className="inline-block text-sm text-accent underline">
          {t(action.label)}
        </Link>
      )}
    </div>
  )
}
