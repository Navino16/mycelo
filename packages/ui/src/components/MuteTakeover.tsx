import { useState } from 'react'
import { Link } from 'react-router'
import { ApiError, api } from '../api/client.ts'
import { useHealth } from '../health.tsx'
import { useT } from '../i18n.tsx'
import { TONE_CLASSES } from './tone.ts'

/**
 * Replaces the route body while an enforcing inhibitor is blocked (design note 1a): a mute bot
 * makes every other number on the screen irrelevant. `Set fallback to allow` and the mute age
 * are dropped — an inhibitor has no fallback verdict, and the wire carries a count, not a time.
 */
export function MuteTakeover(
  { names, blocked }: { names: readonly string[], blocked: number },
): React.JSX.Element {
  const t = useT()
  const { refresh } = useHealth()
  const [error, setError] = useState<string | null>(null)
  // The first name, deliberately: `Disable` acts on one plugin, and a button per name would
  // read as "disable them all", which is not what any of them does.
  const first = names[0] ?? ''

  function disable(): void {
    api.send('POST', `/api/plugins/${first}/disable`).then(
      () => refresh().then(() => { setError(null) }),
      (e: unknown) => { setError(e instanceof ApiError ? e.message : t('error.generic')) },
    ).catch(() => { setError(t('error.generic')) })
  }

  const crit = TONE_CLASSES.crit
  return (
    <section role="alert" className={`space-y-4 rounded-xl border p-5 ${crit.border} ${crit.bg}`}>
      <h1 className={`text-hero font-semibold ${crit.text}`}>{t('health.blocked.title')}</h1>
      <p className="max-w-2xl text-body">{t('health.blocked.body', { names: names.join(', ') })}</p>
      <div>
        <p className="text-meta uppercase tracking-wide text-text/60">{t('health.blocked.dropped')}</p>
        <p className={`text-hero font-medium ${crit.text}`}>{String(blocked)}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={disable}
          className={`rounded-md px-3 py-2 font-medium text-white ${crit.fill}`}
        >
          {t('health.blocked.disable', { name: first })}
        </button>
        <Link to={`/plugins/${first}/settings`} className="rounded-md border border-line px-3 py-2 text-body">
          {t('health.blocked.configure')}
        </Link>
      </div>
      <p className="text-meta-lg text-text/60">{t('health.blocked.consequence')}</p>
      {/* Inside the section, which is already the live region: a nested role="alert" would
          announce the same failure twice. */}
      {error !== null && <p className={`text-body ${crit.text}`}>{error}</p>}
    </section>
  )
}
