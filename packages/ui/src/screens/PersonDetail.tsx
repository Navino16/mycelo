import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { api, ApiError } from '../api/client.ts'
import { readArray } from '../api/read.ts'
import { useT } from '../i18n.tsx'
import type { IdentityDto, PersonDto, RoleDto } from '../api/types.ts'

export function PersonDetail(): React.JSX.Element {
  const t = useT()
  const { id = '' } = useParams()
  const [person, setPerson] = useState<PersonDto | null>(null)
  const [roles, setRoles] = useState<readonly RoleDto[] | null>(null)
  const [error, setError] = useState(false)
  const [name, setName] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [roleToAdd, setRoleToAdd] = useState('')
  const [roleError, setRoleError] = useState<string | null>(null)

  function load(): void {
    Promise.all([
      api.get<PersonDto>(`/api/people/${id}`),
      api.get<readonly RoleDto[]>('/api/roles'),
    ]).then(([p, r]) => {
      setPerson(p)
      setName(p.displayName ?? '')
      setRoles(r)
      setError(false)
    }, () => { setError(true) })
  }

  useEffect(load, [id])

  async function saveName(event: React.SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    try {
      const updated = await api.send<PersonDto>('PATCH', `/api/people/${id}`, { displayName: name })
      setPerson(updated)
      setSaveError(null)
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : t('error.generic'))
    }
  }

  async function markReviewed(): Promise<void> {
    try {
      const updated = await api.send<PersonDto>('PATCH', `/api/people/${id}`, { reviewed: true })
      setPerson(updated)
      setReviewError(null)
    } catch (e) {
      setReviewError(e instanceof ApiError ? e.message : t('error.generic'))
    }
  }

  async function addRole(event: React.SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (roleToAdd === '') return
    try {
      await api.send('POST', `/api/people/${id}/roles`, { role: roleToAdd })
      setRoleToAdd('')
      setRoleError(null)
      load()
    } catch (e) {
      setRoleError(e instanceof ApiError ? e.message : t('error.generic'))
    }
  }

  async function removeRole(role: string): Promise<void> {
    try {
      await api.send('DELETE', `/api/people/${id}/roles/${role}`)
      setRoleError(null)
      load()
    } catch (e) {
      setRoleError(e instanceof ApiError ? e.message : t('error.generic'))
    }
  }

  const identities = readArray<IdentityDto>(person?.identities) ?? []
  const heldRoles = readArray<string>(person?.roles) ?? []
  const availableRoles = (readArray<RoleDto>(roles) ?? []).filter((r) => !heldRoles.includes(r.name))

  return (
    <div className="space-y-6">
      {error && <p role="alert" className="text-sm text-crit">{t('error.generic')}</p>}

      {person !== null && (
        <>
          <header className="space-y-2">
            <h1 className="text-xl font-medium">{person.displayName ?? person.id}</h1>
            <form onSubmit={(e) => { void saveName(e) }} className="flex flex-wrap items-end gap-2">
              <label className="block space-y-1 text-sm">
                <span className="text-xs text-text/60">{t('person.displayName')}</span>
                <input
                  value={name}
                  onChange={(e) => { setName(e.target.value) }}
                  className="w-full rounded-md border border-line bg-surface px-2 py-1"
                />
              </label>
              <button type="submit" className="rounded-md bg-accent px-3 py-2 text-accent-ink">
                {t('action.save')}
              </button>
            </form>
            {saveError !== null && <p role="alert" className="text-sm text-crit">{saveError}</p>}

            {/* No inverse: the store cannot un-review, so the control disappears once true rather
                than offering a toggle that would silently do nothing. */}
            {!person.reviewed && (
              <button
                type="button"
                onClick={() => { void markReviewed() }}
                className="rounded-md border border-line px-3 py-1.5 text-sm"
              >
                {t('person.markReviewed')}
              </button>
            )}
            {reviewError !== null && <p role="alert" className="text-sm text-crit">{reviewError}</p>}
          </header>

          <section className="space-y-2">
            <h2 className="font-medium">{t('person.identities')}</h2>
            <ul className="divide-y divide-line-soft rounded-lg border border-line">
              {identities.map((i) => (
                <li key={`${i.channel}:${i.externalId}`} className="p-3 text-sm">
                  <span className="font-mono">{i.channel}</span>
                  <span className="ml-2 font-mono text-text/70">{i.externalId}</span>
                  {i.displayName !== undefined && <span className="ml-2 text-text/70">{i.displayName}</span>}
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="font-medium">{t('person.roles')}</h2>
            <ul className="flex flex-wrap gap-2">
              {heldRoles.map((role) => (
                <li key={role} className="flex items-center gap-2 rounded-full bg-line-soft px-3 py-1 text-sm">
                  {role}
                  <button
                    type="button"
                    aria-label={t('person.removeRole', { role })}
                    onClick={() => { void removeRole(role) }}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            {availableRoles.length > 0 && (
              <form onSubmit={(e) => { void addRole(e) }} className="flex flex-wrap items-end gap-2">
                <label className="block space-y-1 text-sm">
                  <span className="text-xs text-text/60">{t('people.role')}</span>
                  <select
                    value={roleToAdd}
                    onChange={(e) => { setRoleToAdd(e.target.value) }}
                    className="rounded-md border border-line bg-surface px-2 py-1"
                  >
                    <option value="">—</option>
                    {availableRoles.map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}
                  </select>
                </label>
                <button type="submit" className="rounded-md bg-accent px-3 py-2 text-accent-ink">
                  {t('person.addRole')}
                </button>
              </form>
            )}
            {roleError !== null && <p role="alert" className="text-sm text-crit">{roleError}</p>}
          </section>
        </>
      )}
    </div>
  )
}
