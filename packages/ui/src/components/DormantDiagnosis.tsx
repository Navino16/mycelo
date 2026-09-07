import { Link } from 'react-router'
import { useT } from '../i18n.tsx'
import { TONE_CLASSES } from './tone.ts'
import type { StringKey } from '../../locales/en.ts'

export interface Diagnosis { title: StringKey, action?: { to: string, label: StringKey } }

/**
 * design §2.2: the wire carries a rendered sentence for display and its key for this. A
 * classifier reading the sentence answered `other` for every locale but English (plan
 * correction 2) — the prefix rule the old comment described was English grammar, not data.
 */
export const BY_KEY: Record<string, Diagnosis['title']> = {
  'refusal.config.incomplete': 'dormant.config',
  'refusal.config.undeclaredSecrets': 'dormant.config',
  'refusal.config.validationThrew': 'dormant.config',
  'refusal.plugin.septumIncompatible': 'dormant.version',
  'refusal.germination.dependencyDormant': 'dormant.dependency',
  'refusal.germination.anyOfDependencyDormant': 'dormant.dependency',
  'refusal.germination.anyOfNoneInstalled': 'dormant.dependency',
  'refusal.germination.requiredRhizaMissing': 'dormant.dependency',
  'refusal.germination.requiredRhizaWrongKind': 'dormant.dependency',
  'refusal.germination.scopeNotMounted': 'dormant.dependency',
  'refusal.germination.scopeLaterPhase': 'dormant.dependency',
  'refusal.germination.duplicateName': 'dormant.collision',
  'refusal.germination.reservedName': 'dormant.collision',
  'refusal.germination.reservedDomain': 'dormant.collision',
}

/**
 * Exported: the Overview's attention rows take their action from the same classifier. A key
 * not in the table — every `shape.ts` and `startup` verdict among others — is `dormant.other`,
 * which is what the table lists rather than derives (plan correction 2).
 */
export function diagnose(name: string, reasonKey: string | undefined): Diagnosis {
  const title = (reasonKey === undefined ? undefined : BY_KEY[reasonKey]) ?? 'dormant.other'
  if (title === 'dormant.config') {
    return { title, action: { to: `/plugins/${name}/settings`, label: 'dormant.fixConfig' } }
  }
  if (title === 'dormant.collision') {
    return { title, action: { to: '/plugins', label: 'dormant.setAlias' } }
  }
  return { title }
}

export function DormantDiagnosis(
  { name, reason, reasonKey }: { name: string, reason: string, reasonKey?: string },
): React.JSX.Element {
  const t = useT()
  const { title, action } = diagnose(name, reasonKey)
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
