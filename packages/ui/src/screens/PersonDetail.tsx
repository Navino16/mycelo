import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { api, ApiError } from '../api/client.ts'
import { readArray } from '../api/read.ts'
import { Avatar } from '../components/Avatar.tsx'
import { Breadcrumb } from '../components/Breadcrumb.tsx'
import { Chip } from '../components/Chip.tsx'
import { Dot } from '../components/Dot.tsx'
import { TONE_CLASSES } from '../components/tone.ts'
import { useT } from '../i18n.tsx'
import { effectiveCommands, effectiveWildcards } from '../rights.ts'
import type {
  CommandDto, CommandGroups, ConfigDto, IdentityDto, PersonDto, RoleDto,
} from '../api/types.ts'

function flatten(groups: CommandGroups | null): readonly CommandDto[] {
  if (groups === null || typeof groups !== 'object' || Array.isArray(groups)) return []
  return Object.values(groups).flatMap((g) => readArray<CommandDto>(g) ?? [])
}

export function PersonDetail(): React.JSX.Element {
  const t = useT()
  const { id = '' } = useParams()
  const [person, setPerson] = useState<PersonDto | null>(null)
  const [roles, setRoles] = useState<readonly RoleDto[] | null>(null)
  const [commands, setCommands] = useState<CommandGroups | null>(null)
  const [defaultRole, setDefaultRole] = useState<string | undefined>(undefined)
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

  // The two joins own no error flag: a refusal costs the rights panel or the banner, never
  // the person.
  useEffect(() => {
    api.get<CommandGroups>('/api/commands').then((c) => { setCommands(c) }, () => undefined)
    api.get<ConfigDto>('/api/config').then((c) => { setDefaultRole(c.defaultRole) }, () => undefined)
  }, [])

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
  const roleList = readArray<RoleDto>(roles) ?? []
  const availableRoles = roleList.filter((r) => !heldRoles.includes(r.name))
  const totalCommands = flatten(commands).length
  const granted = commands === null || roles === null
    ? null
    : effectiveCommands(heldRoles, roleList, commands)
  const wildcards = roles === null ? [] : effectiveWildcards(heldRoles, roleList)
  const banner = person !== null && !person.reviewed && defaultRole !== undefined

  const ok = TONE_CLASSES.ok
  const warn = TONE_CLASSES.warn
  const crit = TONE_CLASSES.crit

  const reviewButton = (
    <button
      type="button"
      onClick={() => { void markReviewed() }}
      className="rounded-md bg-accent px-3 py-2 font-medium text-accent-ink"
    >
      {t('person.markReviewed')}
    </button>
  )

  return (
    <div className="space-y-4">
      {error && <p role="alert" className={`text-body ${warn.text}`}>{t('error.generic')}</p>}

      {person !== null && (
        <>
          <div className="space-y-1">
            <Breadcrumb trail={[{ label: t('people.title'), to: '/people' }]} />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar person={person} />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="truncate text-page font-semibold">{person.displayName ?? person.id}</h1>
                    {!person.reviewed && <Chip label={t('person.neverReviewedTitle')} tone="warn" />}
                  </div>
                  <p className="text-meta-lg text-text/60">
                    {t(identities.length === 1 ? 'person.identityCountOne' : 'person.identityCount', {
                      count: identities.length,
                    })}
                  </p>
                </div>
              </div>
              {/* Only where the banner is not: two identical primaries on one screen is what
                  2i-desktop and 2i-mobile each draw half of. */}
              {!person.reviewed && !banner && reviewButton}
            </div>
          </div>

          {banner && (
            <section
              data-testid="never-reviewed"
              className={`space-y-2 rounded-xl border p-4 ${warn.border} ${warn.bg}`}
            >
              <h2 className={`text-title font-semibold ${warn.text}`}>{t('person.neverReviewedTitle')}</h2>
              <p className="max-w-2xl text-body">
                {t('person.neverReviewedLead', { role: defaultRole ?? '' })}
              </p>
              {reviewButton}
            </section>
          )}
          {reviewError !== null && <p role="alert" className={`text-body ${crit.text}`}>{reviewError}</p>}

          <div className="grid gap-4 md:grid-cols-2">
            <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
              <div className="flex items-baseline gap-2">
                <h2 className="text-title font-semibold">{t('person.identities')}</h2>
                <span aria-hidden="true" className="text-text/40">·</span>
                <span className="font-mono text-body text-text/60">{identities.length}</span>
              </div>
              <ul className="divide-y divide-line-soft">
                {identities.map((i) => (
                  <li key={`${i.channel}:${i.externalId}`} className="flex flex-wrap items-baseline gap-2 py-2">
                    <Dot tone="ok" />
                    <span className="text-body font-medium">{i.channel}</span>
                    <span className="font-mono text-meta-lg text-text/70">{i.externalId}</span>
                    {i.displayName !== undefined && (
                      <span className="text-meta-lg text-text/60">{i.displayName}</span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="text-meta-lg text-text/60">{t('person.mergeManual')}</p>
            </section>

            {granted !== null && (
              <section data-testid="rights" className="space-y-3 rounded-xl border border-line bg-surface p-4">
                <h2 className={`text-title font-semibold ${ok.text}`}>
                  {t(totalCommands === 1 ? 'person.mayRunOne' : 'person.mayRun', {
                    granted: granted.length, total: totalCommands,
                  })}
                </h2>
                <ul className="space-y-1">
                  {granted.map((c) => (
                    <li key={c.qualified} className="font-mono text-body text-text/80">{c.qualified}</li>
                  ))}
                </ul>
                <p className="text-meta-lg text-text/60">
                  {wildcards.length === 0
                    ? t('person.noWildcard')
                    : t(wildcards.length === 1 ? 'person.wildcardsOne' : 'person.wildcards', {
                        names: wildcards.join(', '),
                      })}
                </p>
              </section>
            )}

            <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
              <h2 className="text-title font-semibold">{t('person.roles')}</h2>
              <ul className="flex flex-wrap gap-2">
                {heldRoles.map((role) => (
                  <li
                    key={role}
                    className="flex items-center gap-2 rounded-full border border-line px-3 py-1 font-mono text-meta-lg"
                  >
                    {role}
                    <button
                      type="button"
                      aria-label={t('person.removeRole', { role })}
                      onClick={() => { void removeRole(role) }}
                      className="text-text/60 hover:text-text"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
              {availableRoles.length > 0 && (
                <form onSubmit={(e) => { void addRole(e) }} className="flex flex-wrap items-end gap-2">
                  <label className="block space-y-1">
                    <span className="text-meta text-text/60">{t('people.filterRole')}</span>
                    <select
                      value={roleToAdd}
                      onChange={(e) => { setRoleToAdd(e.target.value) }}
                      className="rounded-md border border-line bg-surface px-3 py-2 font-mono text-body"
                    >
                      <option value="">—</option>
                      {availableRoles.map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}
                    </select>
                  </label>
                  <button type="submit" className="rounded-md border border-line px-3 py-2 text-body">
                    {t('person.addRole')}
                  </button>
                </form>
              )}
              {roleError !== null && <p role="alert" className={`text-body ${crit.text}`}>{roleError}</p>}
              <p className="text-meta-lg text-text/60">{t('person.rolesLead')}</p>
            </section>

            <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
              <form onSubmit={(e) => { void saveName(e) }} className="flex flex-wrap items-end gap-2">
                <label className="block space-y-1">
                  <span className="text-meta text-text/60">{t('person.displayName')}</span>
                  <input
                    value={name}
                    onChange={(e) => { setName(e.target.value) }}
                    className="w-full rounded-md border border-line bg-surface px-3 py-2 text-body"
                  />
                </label>
                <button type="submit" className="rounded-md border border-line px-3 py-2 text-body">
                  {t('action.save')}
                </button>
              </form>
              {saveError !== null && <p role="alert" className={`text-body ${crit.text}`}>{saveError}</p>}
            </section>
          </div>
        </>
      )}
    </div>
  )
}
