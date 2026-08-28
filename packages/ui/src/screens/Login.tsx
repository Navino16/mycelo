import { useState } from 'react'
import { api, ApiError } from '../api/client.ts'
import { useT } from '../i18n.tsx'

export function Login({ onDone }: { onDone: () => void }): React.JSX.Element {
  const t = useT()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    try {
      await api.send('POST', '/api/login', { username, password })
      setError(null)
      onDone()
    } catch (e) {
      // The server's sentence is not in the operator's locale on this route (see Setup);
      // a wrong password is the only case worth naming, everything else is generic.
      setError(e instanceof ApiError && e.code === 'unauthenticated' ? t('login.failed') : t('error.generic'))
    }
  }

  return (
    <form onSubmit={(e) => { void submit(e) }} className="mx-auto mt-16 w-full max-w-sm space-y-4 p-4">
      <h1 className="text-xl font-medium">{t('login.title')}</h1>
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
          autoComplete="current-password"
        />
      </label>
      {error !== null && <p role="alert" className="text-sm text-crit">{error}</p>}
      <button type="submit" className="w-full rounded-md bg-accent px-3 py-2 text-accent-ink">
        {t('login.submit')}
      </button>
    </form>
  )
}
