import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api, ApiError } from '../api/client.ts'
import { readArray } from '../api/read.ts'
import type { ConfigDto, RoleDto } from '../api/types.ts'
import { useT } from '../i18n.tsx'

export function Roles(): React.JSX.Element {
  const t = useT()
  const [roles, setRoles] = useState<readonly RoleDto[] | null>(null)
  const [defaultRole, setDefaultRole] = useState<string | undefined>(undefined)
  const [error, setError] = useState(false)
  const [name, setName] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  function load(): void {
    Promise.all([
      api.get<readonly RoleDto[]>('/api/roles'),
      api.get<ConfigDto>('/api/config'),
    ]).then(([r, c]) => {
      setRoles(r)
      setDefaultRole(c.defaultRole)
      setError(false)
    }, () => { setError(true) })
  }

  useEffect(load, [])

  async function add(event: React.SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    try {
      await api.send('POST', '/api/roles', { name })
      setName('')
      setAddError(null)
      load()
    } catch (e) {
      setAddError(e instanceof ApiError ? e.message : t('error.generic'))
    }
  }

  async function remove(role: string): Promise<void> {
    setDeleteError(null)
    try {
      await api.send('DELETE', `/api/roles/${role}`)
      load()
    } catch (e) {
      setDeleteError(e instanceof ApiError ? e.message : t('error.generic'))
    }
  }

  const list = readArray<RoleDto>(roles) ?? []

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-medium">{t('roles.title')}</h1>
      {error && <p role="alert" className="text-sm text-crit">{t('error.generic')}</p>}

      {roles !== null && (
        <ul className="divide-y divide-line-soft rounded-lg border border-line">
          {list.map((role) => {
            const isDefault = role.name === defaultRole
            return (
              <li key={role.name} className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to={`/roles/${role.name}`} className="font-mono">{role.name}</Link>
                    {isDefault && (
                      <span className="rounded-full bg-accent/20 px-2 py-0.5 text-xs text-accent">
                        {t('roles.default')}
                      </span>
                    )}
                    {role.builtin && (
                      <span className="rounded-full bg-line-soft px-2 py-0.5 text-xs">{t('roles.builtin')}</span>
                    )}
                  </div>
                  {isDefault && <p className="text-sm text-text/70">{t('roles.defaultLead')}</p>}
                </div>
                {!isDefault && !role.builtin && (
                  <button
                    type="button"
                    onClick={() => { void remove(role.name) }}
                    className="rounded-md border border-line px-3 py-1.5 text-sm text-text/70"
                  >
                    {t('action.delete')}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {deleteError !== null && <p role="alert" className="text-sm text-crit">{deleteError}</p>}

      <form
        onSubmit={(e) => { void add(e) }}
        className="flex flex-wrap items-end gap-2 rounded-lg border border-line p-3"
      >
        <label className="block space-y-1 text-sm">
          <span className="text-xs text-text/60">{t('roles.create')}</span>
          <input
            value={name}
            onChange={(e) => { setName(e.target.value) }}
            className="w-full rounded-md border border-line bg-surface px-2 py-1"
          />
        </label>
        <button type="submit" className="rounded-md bg-accent px-3 py-2 text-accent-ink">
          {t('roles.create')}
        </button>
      </form>
      {addError !== null && <p role="alert" className="text-sm text-crit">{addError}</p>}
    </div>
  )
}
