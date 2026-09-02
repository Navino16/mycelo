import { Link } from 'react-router'
import { useT } from '../i18n.tsx'
import type { StringKey } from '../../locales/en.ts'

interface Diagnosis { title: StringKey, action?: { to: string, label: StringKey } }

/**
 * One `reason` string per cause; the order matters, the first match wins. Matched against the
 * literal messages germination/germinate.ts and germination/anastomoses.ts actually produce —
 * "already claimed by" is the real per-plugin duplicate-name reason (anastomoses.ts); the
 * command-collision message ("declared by") halts the whole germination instead of a single
 * plugin's `reason`, so it is kept here only for a future core that surfaces it per plugin.
 */
function diagnose(name: string, reason: string): Diagnosis {
  if (/configuration rejected|configuration is incomplete/i.test(reason)) {
    return { title: 'dormant.config', action: { to: `/plugins/${name}/settings`, label: 'dormant.fixConfig' } }
  }
  if (/septum|range|version/i.test(reason)) return { title: 'dormant.version' }
  if (/not installed|requires|any_of|dependency/i.test(reason)) return { title: 'dormant.dependency' }
  if (/already claimed|declared by/i.test(reason)) {
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
