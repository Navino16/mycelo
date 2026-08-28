import { useState } from 'react'
import { api, ApiError } from '../api/client.ts'
import { useT } from '../i18n.tsx'

const MIN_PASSWORD = 8

export function Setup({ onDone }: { onDone: () => void }): React.JSX.Element {
  const t = useT()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (password.length < MIN_PASSWORD) { setError(t('setup.passwordRule')); return }
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
    <form onSubmit={(e) => { void submit(e) }} className="mx-auto mt-16 w-full max-w-sm space-y-4 p-4">
      <h1 className="text-xl font-medium">{t('setup.title')}</h1>
      <p className="text-sm text-text/70">{t('setup.lead')}</p>
      <label className="block space-y-1">
        <span className="text-sm">{t('setup.username')}</span>
        <input
          value={username}
          onChange={(e) => { setUsername(e.target.value) }}
          className="w-full rounded-md border border-line bg-surface px-3 py-2"
          autoComplete="username"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-sm">{t('setup.password')}</span>
        <input
          type="password"
          value={password}
          onChange={(e) => { setPassword(e.target.value) }}
          className="w-full rounded-md border border-line bg-surface px-3 py-2"
          autoComplete="new-password"
        />
        <span className="text-xs text-text/60">{t('setup.passwordRule')}</span>
      </label>
      {error !== null && <p role="alert" className="text-sm text-crit">{error}</p>}
      <button type="submit" className="w-full rounded-md bg-accent px-3 py-2 text-accent-ink">
        {t('setup.submit')}
      </button>
    </form>
  )
}
