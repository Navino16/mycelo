import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { ApiError, api } from '../api/client.ts'
import { useHealth } from '../health.tsx'
import { useT } from '../i18n.tsx'
import { TONE_CLASSES } from './tone.ts'
import type { MutationResult } from '../api/types.ts'

/** Replaces the route body while an enforcing inhibitor is blocked (design note 1a). */
export function MuteTakeover(
  { names, blocked }: { names: readonly string[], blocked: number },
): React.JSX.Element {
  const t = useT()
  const { refresh } = useHealth()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [busy, setBusy] = useState(false)
  // A ref, not `busy`: two clicks in one tick both read the same render's state, and disabling
  // a plugin twice is a second POST against a substrate already mid-restart.
  const inFlight = useRef(false)
  // The first name, deliberately: `Disable` acts on one plugin, and a button per name would
  // read as "disable them all", which is not what any of them does.
  const first = names[0] ?? ''

  function settle(message: string | null, restart: boolean): void {
    setError(message)
    setPending(restart)
    setBusy(false)
    inFlight.current = false
  }

  function disable(): void {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    api.send<MutationResult>('POST', `/api/plugins/${first}/disable`).then(
      (result) => refresh().then(() => { settle(null, result.restartRequired === true) }),
      (e: unknown) => { settle(e instanceof ApiError ? e.message : t('error.generic'), false) },
    ).catch(() => { settle(t('error.generic'), false) })
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
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={disable}
          disabled={busy}
          className={`rounded-md px-3 py-2 font-medium text-white disabled:opacity-60 ${crit.fill}`}
        >
          {t('health.blocked.disable', { name: first })}
        </button>
        <Link to={`/plugins/${first}/settings`} className="rounded-md border border-line px-3 py-2 text-body">
          {t('health.blocked.configure')}
        </Link>
        {pending && <span className="text-body text-text/70">{t('state.pending')}</span>}
      </div>
      <p className="text-meta-lg text-text/60">{t('health.blocked.consequence')}</p>
      {/* Inside the section, which is already the live region: a nested role="alert" would
          announce the same failure twice. */}
      {error !== null && <p className={`text-body ${crit.text}`}>{error}</p>}
    </section>
  )
}
