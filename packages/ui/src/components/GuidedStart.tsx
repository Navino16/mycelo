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
      <div className="space-y-1">
        <h2 className="text-title font-medium">{t('guided.nothingInstalled')}</h2>
        <p className="text-body text-text/70">{t('guided.nothingInstalledLead')}</p>
      </div>
      <ol className="grid gap-3 md:grid-cols-3">
        {steps.map((step, index) => (
          <li
            key={step}
            className={[
              'flex flex-col gap-2 rounded-xl border p-4',
              index === 0 ? 'border-accent' : 'border-line',
            ].join(' ')}
          >
            <div className="flex items-start gap-3">
              {/* 1b numbers what is left to do, not the fixed three: the first remaining
                  step is always 1. */}
              <span
                data-step-number
                className="flex size-[26px] shrink-0 items-center justify-center rounded-md bg-surface2 font-mono text-meta-lg"
              >
                {index + 1}
              </span>
              <div className="space-y-1">
                <p className="text-title font-medium">{t(`guided.${step}` as StringKey)}</p>
                <p className="text-body text-text/70">{t(`guided.${step}Lead` as StringKey)}</p>
              </div>
            </div>
            <Link
              to={TARGET[step]}
              className={[
                'mt-auto rounded-md px-3 py-2 text-center text-body font-medium',
                index === 0 ? 'bg-accent text-accent-ink' : 'border border-line',
              ].join(' ')}
            >
              {t(`guided.${step}Cta` as StringKey)}
            </Link>
          </li>
        ))}
      </ol>
      <p className="text-meta-lg text-text/60">{t('guided.registryNote')}</p>
    </section>
  )
}
