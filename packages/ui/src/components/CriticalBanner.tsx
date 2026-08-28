import { AlertTriangle } from 'lucide-react'
import { useHealth } from '../health.tsx'
import { useT } from '../i18n.tsx'

export function CriticalBanner(): React.JSX.Element | null {
  const t = useT()
  const { health, error } = useHealth()

  if (error) return <Banner title={t('error.offline')} body="" />
  if (health === null) return null

  // Absent is not empty: a health payload with no enforcingBlocked cannot be read as
  // "nothing is blocked" — that would report a mute bot as healthy.
  if (!Array.isArray(health.enforcingBlocked)) {
    return <Banner title={t('health.blocked.title')} body={t('health.blocked.unknown')} />
  }
  if (health.enforcingBlocked.length === 0) return null

  return (
    <Banner
      title={t('health.blocked.title')}
      body={t('health.blocked.body', { names: health.enforcingBlocked.join(', ') })}
    />
  )
}

function Banner({ title, body }: { title: string, body: string }): React.JSX.Element {
  return (
    <div role="alert" className="flex items-start gap-3 border-b border-crit bg-crit-bg px-4 py-3">
      <AlertTriangle size={18} className="mt-0.5 shrink-0 text-crit" />
      <div className="min-w-0">
        <p className="font-medium text-crit">{title}</p>
        {body !== '' && <p className="text-sm text-text/80">{body}</p>}
      </div>
    </div>
  )
}
