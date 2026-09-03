import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { api } from '../api/client.ts'
import { readArray } from '../api/read.ts'
import { Avatar } from '../components/Avatar.tsx'
import { BulkBar } from '../components/BulkBar.tsx'
import { Chip } from '../components/Chip.tsx'
import { EmptyState } from '../components/EmptyState.tsx'
import { TONE_CLASSES } from '../components/tone.ts'
import { plural, useT } from '../i18n.tsx'
import type { PageDto, PersonDto, RoleDto } from '../api/types.ts'

const DEBOUNCE_MS = 300
const SIZES: readonly number[] = [25, 50, 100]

/** The route caps perPage at 200, so a substrate with more never-reviewed selects the first 200. */
const SELECT_ALL_CAP = 200

const COLUMNS
  = 'grid-cols-[1.25rem_minmax(0,1fr)] md:grid-cols-[1.25rem_minmax(0,1fr)_minmax(0,13rem)_minmax(0,9rem)_7rem]'
/** Below md the four data cells stack under the name, in the checkbox's own column. */
const STACKED = 'col-start-2 md:col-start-auto'

export function People(): React.JSX.Element {
  const t = useT()
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')
  const [reviewedOnly, setReviewedOnly] = useState(false)
  const [role, setRole] = useState('')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(SIZES[0] ?? 25)
  const [reload, setReload] = useState(0)
  const [data, setData] = useState<PageDto<PersonDto> | null>(null)
  const [error, setError] = useState(false)
  const [roles, setRoles] = useState<readonly RoleDto[] | null>(null)
  const [neverReviewed, setNeverReviewed] = useState<number | undefined>(undefined)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [message, setMessage] = useState<string | undefined>(undefined)
  const requestGeneration = useRef(0)

  // Page reset lives in the event handlers below, not in an effect keyed on the filters: a
  // filter change reads as a new search, and setState-in-an-effect is the pattern
  // react-hooks/set-state-in-effect exists to catch.
  useEffect(() => {
    const id = setTimeout(() => { setQ(qInput); setPage(1) }, DEBOUNCE_MS)
    return () => { clearTimeout(id) }
  }, [qInput])

  useEffect(() => {
    // A generation counter, not an AbortController: client.ts's api.get takes no signal, and a
    // stale response arriving after a newer request must not overwrite what it fetched.
    const generation = ++requestGeneration.current
    const params = new URLSearchParams({ page: String(page), perPage: String(perPage) })
    if (q !== '') params.set('q', q)
    if (reviewedOnly) params.set('reviewed', 'false')
    if (role !== '') params.set('role', role)
    api.get<PageDto<PersonDto>>(`/api/people?${params.toString()}`).then(
      (d) => { if (generation === requestGeneration.current) { setData(d); setError(false) } },
      () => { if (generation === requestGeneration.current) setError(true) },
    )
  }, [page, perPage, q, reviewedOnly, role, reload])

  function countNeverReviewed(): void {
    api.get<PageDto<PersonDto>>('/api/people?reviewed=false&perPage=1').then(
      (p) => { setNeverReviewed(p.total) },
      () => { /* a refused count leaves the chip bare, never the screen */ },
    )
  }

  useEffect(() => {
    api.get<readonly RoleDto[]>('/api/roles').then((r) => { setRoles(r) }, () => undefined)
    countNeverReviewed()
  }, [])

  function toggleNeverReviewed(): void {
    setReviewedOnly((prev) => !prev)
    setPage(1)
  }

  function changeRole(next: string): void {
    setRole(next)
    setPage(1)
  }

  function changePerPage(next: number): void {
    setPerPage(next)
    setPage(1)
  }

  function clearSearch(): void {
    setQInput('')
    setQ('')
    setPage(1)
  }

  function toggleSelect(id: string, checked: boolean): void {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id); else next.delete(id)
      return next
    })
  }

  /**
   * One loop for all three bulk actions, reporting through the same `{ok} of {total} … ({seconds}s)`
   * shape: design spec §10.3 assigns the measurement, and a partial failure must be visible.
   */
  async function bulk(
    run: (id: string) => Promise<unknown>,
    key: 'people.assigned' | 'people.unassigned' | 'people.markedReviewed',
  ): Promise<void> {
    const ids = [...selected]
    if (ids.length === 0) return
    const start = performance.now()
    const results = await Promise.allSettled(ids.map(run))
    const seconds = ((performance.now() - start) / 1000).toFixed(1)
    const ok = results.filter((r) => r.status === 'fulfilled').length
    setMessage(plural(t, key, ids.length, { ok, total: ids.length, seconds }))
    setSelected(new Set())
    setReload((n) => n + 1)
    countNeverReviewed()
  }

  function addRole(next: string): void {
    if (next === '') return
    void bulk(
      (id) => api.send('POST', `/api/people/${id}/roles`, { role: next }),
      'people.assigned',
    )
  }

  function removeRole(next: string): void {
    if (next === '') return
    void bulk(
      (id) => api.send('DELETE', `/api/people/${id}/roles/${next}`),
      'people.unassigned',
    )
  }

  function markReviewed(): void {
    void bulk(
      (id) => api.send('PATCH', `/api/people/${id}`, { reviewed: true }),
      'people.markedReviewed',
    )
  }

  function selectNeverReviewed(): void {
    api.get<PageDto<PersonDto>>(`/api/people?reviewed=false&perPage=${String(SELECT_ALL_CAP)}`).then(
      (p) => { setSelected(new Set((readArray<PersonDto>(p.items) ?? []).map((person) => person.id))) },
      () => { /* a refused selection leaves the current one alone */ },
    )
  }

  const items = readArray<PersonDto>(data?.items) ?? []
  const total = data?.total ?? 0
  const size = data?.perPage ?? perPage
  const pages = Math.max(1, Math.ceil(total / size))
  const from = total === 0 ? 0 : (page - 1) * size + 1
  const to = Math.min(page * size, total)
  const roleList = readArray<RoleDto>(roles) ?? []
  const warn = TONE_CLASSES.warn

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-page font-semibold">{t('people.title')}</h1>
          {data !== null && (
            <p className="text-meta-lg text-text/60">
              {plural(t, 'people.known', total, { total })}
            </p>
          )}
        </div>
        <label className="block space-y-1">
          <span className="text-meta text-text/60">{t('people.search')}</span>
          <input
            value={qInput}
            onChange={(e) => { setQInput(e.target.value) }}
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-body md:w-80"
          />
        </label>
      </div>

      {error && <p role="alert" className={`text-body ${warn.text}`}>{t('error.generic')}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <Chip
          label={plural(t, 'people.neverReviewed', neverReviewed ?? 0)}
          count={neverReviewed}
          tone="warn"
          active={reviewedOnly}
          onClick={toggleNeverReviewed}
        />
        <select
          aria-label={t('people.filterRole')}
          value={role}
          onChange={(e) => { changeRole(e.target.value) }}
          className="rounded-full border border-line bg-surface px-3 py-1 text-meta-lg"
        >
          <option value="">{t('people.filterRoleAny')}</option>
          {roleList.map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}
        </select>
      </div>

      <BulkBar
        count={selected.size}
        roles={roleList.map((r) => r.name)}
        neverReviewed={neverReviewed}
        onClear={() => { setSelected(new Set()); setMessage(undefined) }}
        onAddRole={addRole}
        onRemoveRole={removeRole}
        onMarkReviewed={markReviewed}
        onSelectNeverReviewed={selectNeverReviewed}
        message={message}
      />

      {data !== null && items.length === 0 && (
        <EmptyState
          title={t('people.noMatch')}
          body={t('people.noMatchLead')}
          action={q === ''
            ? undefined
            : (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="rounded-md border border-line px-3 py-2 text-body"
                >
                  {t('people.clearSearch')}
                </button>
              )}
        />
      )}

      {items.length > 0 && (
        <div className="rounded-lg border border-line">
          <div
            className={`hidden gap-3 border-b border-line px-3 py-2 text-meta uppercase tracking-wide text-text/60 md:grid ${COLUMNS}`}
          >
            <span />
            <span>{t('people.colPerson')}</span>
            <span>{t('people.colIdentities')}</span>
            <span>{t('people.colRoles')}</span>
            <span>{t('people.colReview')}</span>
          </div>
          <ul className="divide-y divide-line-soft">
            {items.map((person) => {
              const label = person.displayName ?? person.id
              const identities = (readArray<{ channel: string }>(person.identities) ?? [])
                .map((i) => i.channel).join(' · ')
              const held = (readArray<string>(person.roles) ?? []).join(', ')
              return (
                <li
                  key={person.id}
                  data-testid={`person-${person.id}`}
                  className={`grid items-center gap-x-3 gap-y-1 p-3 ${COLUMNS}`}
                >
                  <input
                    type="checkbox"
                    aria-label={label}
                    checked={selected.has(person.id)}
                    onChange={(e) => { toggleSelect(person.id, e.target.checked) }}
                  />
                  <div className="flex min-w-0 items-center gap-2">
                    <Avatar person={person} />
                    <Link to={`/people/${person.id}`} className="truncate text-body font-medium">
                      {label}
                    </Link>
                  </div>
                  <span className={`truncate font-mono text-meta-lg text-text/60 ${STACKED}`}>
                    {identities}
                  </span>
                  <span className={`truncate font-mono text-meta-lg text-text/70 ${STACKED}`}>
                    {held}
                  </span>
                  <span
                    className={`text-meta-lg ${STACKED} ${person.reviewed ? 'text-text/50' : warn.text}`}
                  >
                    {person.reviewed ? t('people.reviewed') : t('person.neverReviewedTitle')}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {data !== null && total > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-meta-lg text-text/60">{t('paging.showing', { from, to, total })}</span>
          <label className="flex items-center gap-2 text-meta-lg text-text/60">
            <span>{t('people.perPage')}</span>
            <select
              value={size}
              onChange={(e) => { changePerPage(Number(e.target.value)) }}
              className="rounded-md border border-line bg-surface px-2 py-1"
            >
              {SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <div className="flex items-center gap-2 md:ml-auto">
            <span className="text-meta-lg text-text/60">{t('people.page', { page, pages })}</span>
            <button
              type="button"
              onClick={() => { setPage((p) => Math.max(1, p - 1)) }}
              disabled={page <= 1}
              className="rounded-md border border-line px-3 py-1.5 text-body disabled:opacity-40"
            >
              {t('people.previous')}
            </button>
            <button
              type="button"
              onClick={() => { setPage((p) => Math.min(pages, p + 1)) }}
              disabled={page >= pages}
              className="rounded-md border border-line px-3 py-1.5 text-body disabled:opacity-40"
            >
              {t('people.next')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
