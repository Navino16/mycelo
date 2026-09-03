import { useState } from 'react'
import { api, ApiError } from '../api/client.ts'
import { TONE_CLASSES } from '../components/tone.ts'
import { useT } from '../i18n.tsx'

const MIN_PASSWORD = 8

const FIELD = 'w-full rounded-md border border-line bg-surface px-3 py-2'

export function Setup({ onDone }: { onDone: () => void }): React.JSX.Element {
  const t = useT()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mismatch = repeat !== '' && repeat !== password
  const valid = username !== '' && password.length >= MIN_PASSWORD && repeat === password

  async function submit(event: React.SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!valid) return
    setError(null)
    try {
      await api.send('POST', '/api/setup', { username, password })
      onDone()
    } catch (e) {
      // A conflict means the wizard already ran elsewhere; the server's own sentence is not
      // in the operator's locale (X-Mycelo-Locale is inert before a session exists).
      setError(e instanceof ApiError && e.code === 'conflict' ? t('setup.conflict') : t('error.generic'))
    }
  }

  return (
    <form
      onSubmit={(e) => { void submit(e) }}
      className="mx-auto mt-16 w-full max-w-md space-y-4 rounded-xl border border-line bg-surface p-6"
    >
      {/* Setup renders outside Layout, hence outside ChromeProvider: no useChrome() here. */}
      <p className="font-mono text-meta uppercase tracking-wide text-text/60">{globalThis.location.host}</p>
      <div className="space-y-1">
        <h1 className="text-page font-medium">{t('setup.title')}</h1>
        <p className="text-body text-text/70">{t('setup.lead')}</p>
      </div>

      <div className="space-y-1">
        <label htmlFor="setup-username" className="block text-body font-medium">{t('setup.username')}</label>
        <input
          id="setup-username"
          value={username}
          onChange={(e) => { setUsername(e.target.value) }}
          className={FIELD}
          autoComplete="username"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="setup-password" className="block text-body font-medium">{t('setup.password')}</label>
        <div className="relative">
          <input
            id="setup-password"
            type={revealed ? 'text' : 'password'}
            value={password}
            onChange={(e) => { setPassword(e.target.value) }}
            className={`${FIELD} pr-20`}
            autoComplete="new-password"
          />
          <button
            type="button"
            onClick={() => { setRevealed(!revealed) }}
            className="absolute inset-y-0 right-3 text-meta-lg text-text/60"
          >
            {t(revealed ? 'setup.hide' : 'setup.show')}
          </button>
        </div>
        <p className="text-meta-lg text-text/60">{t('setup.passwordRule')}</p>
      </div>

      <div className="space-y-1">
        <label htmlFor="setup-repeat" className="block text-body font-medium">{t('setup.repeat')}</label>
        <input
          id="setup-repeat"
          type={revealed ? 'text' : 'password'}
          value={repeat}
          onChange={(e) => { setRepeat(e.target.value) }}
          className={`${FIELD} ${mismatch ? TONE_CLASSES.crit.border : ''}`}
          autoComplete="new-password"
        />
        {/* R1's boundary, the designer's own: 2a-mobile draws this one in crit. */}
        {mismatch && <p className={`text-body ${TONE_CLASSES.crit.text}`}>{t('setup.mismatch')}</p>}
      </div>

      {error !== null && <p role="alert" className={`text-body ${TONE_CLASSES.crit.text}`}>{error}</p>}

      <button
        type="submit"
        disabled={!valid}
        className="w-full rounded-md bg-accent px-3 py-2 font-medium text-accent-ink disabled:bg-surface2 disabled:text-text/50"
      >
        {t('setup.submit')}
      </button>
      <p className="text-meta-lg text-text/60">{t('setup.inertRule')}</p>
    </form>
  )
}
