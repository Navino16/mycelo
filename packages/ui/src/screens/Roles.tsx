import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api, ApiError } from '../api/client.ts'
import { readArray } from '../api/read.ts'
import { Chip } from '../components/Chip.tsx'
import { Sheet } from '../components/Sheet.tsx'
import { TONE_CLASSES } from '../components/tone.ts'
import { grants, wildcardsIn } from '../patterns.ts'
import { useT } from '../i18n.tsx'
import type {
  CommandDto, CommandGroups, ConfigDto, PageDto, PersonDto, RoleDto,
} from '../api/types.ts'

function flatten(groups: CommandGroups | null): readonly CommandDto[] {
  if (groups === null || typeof groups !== 'object' || Array.isArray(groups)) return []
  return Object.values(groups).flatMap((g) => readArray<CommandDto>(g) ?? [])
}

const COLUMNS = 'md:grid-cols-[minmax(0,1fr)_10rem_minmax(0,12rem)_7rem_5rem]'

export function Roles(): React.JSX.Element {
  const t = useT()
  const [roles, setRoles] = useState<readonly RoleDto[] | null>(null)
  const [defaultRole, setDefaultRole] = useState<string | undefined>(undefined)
  const [commands, setCommands] = useState<CommandGroups | null>(null)
  const [people, setPeople] = useState<number | null>(null)
  const [holders, setHolders] = useState<Readonly<Record<string, number>>>({})
  const [error, setError] = useState(false)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  function countHolders(role: string): void {
    api.get<PageDto<PersonDto>>(`/api/people?role=${encodeURIComponent(role)}&perPage=1`).then(
      (page) => { setHolders((prev) => ({ ...prev, [role]: page.total })) },
      () => { /* a refused count leaves that one cell blank, never the table */ },
    )
  }

  function load(): void {
    Promise.all([
      api.get<readonly RoleDto[]>('/api/roles'),
      api.get<ConfigDto>('/api/config'),
    ]).then(([r, c]) => {
      setRoles(r)
      setDefaultRole(c.defaultRole)
      setError(false)
      // Fired from inside this resolution and in parallel, never as a gate on the list: the
      // People column is one request per role and no single refusal may blank the screen.
      for (const role of readArray<RoleDto>(r) ?? []) countHolders(role.name)
    }, () => { setError(true) })
  }

  useEffect(load, [])

  useEffect(() => {
    api.get<CommandGroups>('/api/commands').then((c) => { setCommands(c) }, () => undefined)
    api.get<PageDto<PersonDto>>('/api/people?perPage=1').then((p) => { setPeople(p.total) }, () => undefined)
  }, [])

  async function add(event: React.SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    try {
      await api.send('POST', '/api/roles', { name })
      setName('')
      setAddError(null)
      setAdding(false)
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
  const all = flatten(commands)
  const total = all.length
  const def = list.find((r) => r.name === defaultRole)

  function grantedBy(role: RoleDto): number {
    const patterns = readArray<string>(role.patterns) ?? []
    return all.filter((c) => grants(patterns, c.qualified)).length
  }

  function commandsCell(role: RoleDto): string {
    const granted = grantedBy(role)
    if (granted === total && total > 0) {
      return t(total === 1 ? 'roles.commandsAllOne' : 'roles.commandsAll', { total })
    }
    return t('roles.commandsSome', { granted, total })
  }

  const ok = TONE_CLASSES.ok
  const warn = TONE_CLASSES.warn
  const crit = TONE_CLASSES.crit

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-page font-semibold">{t('roles.title')}</h1>
          {roles !== null && people !== null && (
            <p className="text-meta-lg text-text/60">
              {t(list.length === 1 ? 'roles.summaryOne' : 'roles.summary', {
                roles: list.length, people, commands: total,
              })}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => { setName(''); setAddError(null); setAdding(true) }}
          className="rounded-md bg-accent px-3 py-2 font-medium text-accent-ink"
        >
          {t('roles.create')}
        </button>
      </div>

      {error && <p role="alert" className={`text-body ${warn.text}`}>{t('error.generic')}</p>}

      {def !== undefined && (
        <section className={`space-y-2 rounded-xl border bg-surface p-4 ${ok.border}`}>
          <p className={`text-meta uppercase tracking-wide ${ok.text}`}>{t('roles.defaultCard')}</p>
          <div className="flex flex-wrap items-baseline gap-3">
            <span className={`font-mono text-page font-semibold ${ok.text}`}>{def.name}</span>
            {commands !== null && people !== null && (
              <span className="text-body text-text/70">
                {t(total === 1 ? 'roles.heldByOne' : 'roles.heldBy', {
                  granted: grantedBy(def), total, holders: holders[def.name] ?? 0, people,
                })}
              </span>
            )}
          </div>
          {/* design spec §6: defaultRole comes from mycelo.yaml, so the artboard's
              `Change default` button is stated as a fact instead of shipped disabled. */}
          <p className="text-meta-lg text-text/60">{t('roles.defaultReadOnly')}</p>
          <Link
            to={`/roles/${def.name}`}
            className="inline-block rounded-md bg-accent px-3 py-2 font-medium text-accent-ink"
          >
            {t('roles.editRole', { role: def.name })}
          </Link>
        </section>
      )}

      {roles !== null && (
        <div className="rounded-lg border border-line">
          <div
            className={`hidden gap-3 border-b border-line px-3 py-2 text-meta uppercase tracking-wide text-text/60 md:grid ${COLUMNS}`}
          >
            <span>{t('roles.colRole')}</span>
            <span>{t('roles.colCommands')}</span>
            <span>{t('roles.colWildcards')}</span>
            <span>{t('roles.colPeople')}</span>
            <span />
          </div>
          <ul className="divide-y divide-line-soft">
            {list.map((role) => {
              const patterns = readArray<string>(role.patterns) ?? []
              const isDefault = role.name === defaultRole
              const wildcards = wildcardsIn(patterns)
              const held = holders[role.name]
              const nameTone = isDefault ? ok.text : patterns.includes('*') ? warn.text : ''
              return (
                <li
                  key={role.name}
                  data-testid={`role-${role.name}`}
                  className={`grid items-baseline gap-x-3 gap-y-1 p-3 ${COLUMNS}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to={`/roles/${role.name}`} className={`font-mono font-medium ${nameTone}`}>
                      {role.name}
                    </Link>
                    {isDefault && <Chip label={t('roles.default')} tone="ok" />}
                    {role.builtin && <Chip label={t('roles.builtin')} />}
                  </div>
                  <span className="text-body text-text/70">
                    {commands === null ? '' : commandsCell(role)}
                  </span>
                  <span className="truncate font-mono text-meta-lg text-text/60">
                    {wildcards.length === 0 ? '—' : wildcards.join(', ')}
                  </span>
                  <span className="text-body text-text/70">
                    {held === undefined
                      ? ''
                      : t(held === 1 ? 'roles.holdersOne' : 'roles.holders', { count: held })}
                  </span>
                  {!isDefault && !role.builtin
                    ? (
                        <button
                          type="button"
                          onClick={() => { void remove(role.name) }}
                          className="justify-self-start rounded-md border border-line px-3 py-1.5 text-body text-text/70 md:justify-self-end"
                        >
                          {t('action.delete')}
                        </button>
                      )
                    : <span />}
                  {isDefault && (
                    <p className="text-body text-text/70 md:col-span-5">{t('roles.defaultLead')}</p>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
      {deleteError !== null && <p role="alert" className={`text-body ${crit.text}`}>{deleteError}</p>}

      <Sheet title={t('roles.createTitle')} open={adding} onClose={() => { setAdding(false) }}>
        <form onSubmit={(e) => { void add(e) }} className="space-y-3">
          <label className="block space-y-1" htmlFor="role-name">
            <span className="text-meta-lg text-text/60">{t('roles.create')}</span>
            <input
              id="role-name"
              value={name}
              onChange={(e) => { setName(e.target.value) }}
              className="w-full rounded-md border border-line bg-surface px-3 py-2 font-mono text-body"
            />
          </label>
          {addError !== null && <p role="alert" className={`text-body ${crit.text}`}>{addError}</p>}
          <button
            type="submit"
            className="w-full rounded-md bg-accent px-3 py-2 font-medium text-accent-ink"
          >
            {t('action.save')}
          </button>
        </form>
      </Sheet>
    </div>
  )
}
