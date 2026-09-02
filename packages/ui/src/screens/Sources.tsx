import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api, ApiError } from '../api/client.ts'
import { readArray } from '../api/read.ts'
import type { SourceDto } from '../api/types.ts'
import { useT } from '../i18n.tsx'
import type { StringKey } from '../../locales/en.ts'

function badgeKey(source: SourceDto): StringKey {
  if (!source.enabled) return 'sources.disabled'
  return source.official ? 'sources.official' : 'sources.thirdParty'
}

function SourceRow(
  { source, onSaved }: { source: SourceDto, onSaved: (updated: SourceDto) => void },
): React.JSX.Element {
  const t = useT()
  const [label, setLabel] = useState(source.label)
  const [location, setLocation] = useState(source.location)
  const [token, setToken] = useState(source.token ?? '')
  const [error, setError] = useState<string | null>(null)

  async function save(event: React.SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    try {
      // A token still reading the mask is sent back verbatim: sources.ts skips a value equal
      // to it, so the stored credential survives untouched.
      const updated = await api.send<SourceDto>('PATCH', `/api/sources/${source.id}`, { label, location, token })
      onSaved(updated)
      setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('error.generic'))
    }
  }

  return (
    <li data-testid={`source-${String(source.id)}`} className="space-y-2 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <Link to={`/sources/${String(source.id)}`} className="font-mono">{source.label}</Link>
        <span className="rounded-full bg-line-soft px-2 py-0.5 text-xs">{t(badgeKey(source))}</span>
      </div>
      <form onSubmit={(e) => { void save(e) }} className="grid gap-2 sm:grid-cols-4 sm:items-end">
        <label className="block space-y-1 text-sm">
          <span className="text-xs text-text/60">{t('sources.label')}</span>
          <input
            value={label}
            onChange={(e) => { setLabel(e.target.value) }}
            className="w-full rounded-md border border-line bg-surface px-2 py-1"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-xs text-text/60">{t('sources.location')}</span>
          <input
            value={location}
            onChange={(e) => { setLocation(e.target.value) }}
            className="w-full rounded-md border border-line bg-surface px-2 py-1"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-xs text-text/60">{t('sources.token')}</span>
          <input
            value={token}
            onChange={(e) => { setToken(e.target.value) }}
            className="w-full rounded-md border border-line bg-surface px-2 py-1"
          />
          <span className="text-xs text-text/60">{t('sources.tokenKept')}</span>
        </label>
        <button type="submit" className="rounded-md bg-accent px-3 py-2 text-accent-ink">
          {t('action.save')}
        </button>
      </form>
      {error !== null && <p role="alert" className="text-sm text-crit">{error}</p>}
    </li>
  )
}

export function Sources(): React.JSX.Element {
  const t = useT()
  const [sources, setSources] = useState<readonly SourceDto[] | null>(null)
  const [error, setError] = useState(false)
  const [label, setLabel] = useState('')
  const [location, setLocation] = useState('')
  const [token, setToken] = useState('')
  const [addError, setAddError] = useState<string | null>(null)

  function load(): void {
    api.get<readonly SourceDto[]>('/api/sources').then(
      (v) => { setSources(v); setError(false) },
      () => { setError(true) },
    )
  }

  useEffect(load, [])

  async function add(event: React.SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    try {
      await api.send('POST', '/api/sources', {
        label, driver: 'github', location, ...(token === '' ? {} : { token }),
      })
      setLabel(''); setLocation(''); setToken('')
      setAddError(null)
      load()
    } catch (e) {
      setAddError(e instanceof ApiError ? e.message : t('error.generic'))
    }
  }

  function replaceOne(updated: SourceDto): void {
    setSources((prev) => (prev ?? []).map((s) => (s.id === updated.id ? updated : s)))
  }

  const list = readArray<SourceDto>(sources) ?? []

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-medium">{t('sources.title')}</h1>
      {error && <p role="alert" className="text-sm text-crit">{t('error.generic')}</p>}

      {sources !== null && list.length > 0 && (
        <ul className="divide-y divide-line-soft rounded-lg border border-line">
          {list.map((source) => <SourceRow key={source.id} source={source} onSaved={replaceOne} />)}
        </ul>
      )}

      <form onSubmit={(e) => { void add(e) }} className="space-y-2 rounded-lg border border-line p-3">
        <h2 className="font-medium">{t('sources.add')}</h2>
        <label className="block space-y-1 text-sm">
          <span className="text-xs text-text/60">{t('sources.label')}</span>
          <input
            value={label}
            onChange={(e) => { setLabel(e.target.value) }}
            className="w-full rounded-md border border-line bg-surface px-2 py-1"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-xs text-text/60">{t('sources.location')}</span>
          <input
            value={location}
            onChange={(e) => { setLocation(e.target.value) }}
            className="w-full rounded-md border border-line bg-surface px-2 py-1"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-xs text-text/60">{t('sources.token')}</span>
          <input
            value={token}
            onChange={(e) => { setToken(e.target.value) }}
            className="w-full rounded-md border border-line bg-surface px-2 py-1"
          />
        </label>
        {addError !== null && <p role="alert" className="text-sm text-crit">{addError}</p>}
        <button type="submit" className="rounded-md bg-accent px-3 py-2 text-accent-ink">
          {t('sources.add')}
        </button>
      </form>
    </div>
  )
}
