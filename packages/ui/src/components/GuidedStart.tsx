import { Link } from 'react-router'
import { useT } from '../i18n.tsx'
import type { StringKey } from '../../locales/en.ts'

export interface SubstrateCounts {
  sources: number
  channels: number
  customRoles: number
}

export type Step = 'source' | 'channel' | 'role'

export function outstandingSteps(counts: SubstrateCounts): readonly Step[] {
  const steps: Step[] = []
  if (counts.sources === 0) steps.push('source')
  if (counts.channels === 0) steps.push('channel')
  if (counts.customRoles === 0) steps.push('role')
  return steps
}

const TARGET: Record<Step, string> = {
  source: '/sources',
  channel: '/sources',
  role: '/roles',
}

export function GuidedStart({ counts }: { counts: SubstrateCounts }): React.JSX.Element | null {
  const t = useT()
  const steps = outstandingSteps(counts)
  if (steps.length === 0) return null

  return (
    <section className="space-y-3">
      <h2 className="font-medium">{t('guided.title')}</h2>
      <ol className="grid gap-3 md:grid-cols-3">
        {steps.map((step) => (
          <li key={step} className="rounded-lg border border-line p-4">
            <Link to={TARGET[step]} className="font-medium text-accent">
              {t(`guided.${step}` as StringKey)}
            </Link>
            <p className="mt-1 text-sm text-text/70">{t(`guided.${step}Lead` as StringKey)}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}
