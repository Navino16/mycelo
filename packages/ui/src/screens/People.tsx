import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { api } from '../api/client.ts'
import { readArray } from '../api/read.ts'
import { useT } from '../i18n.tsx'
import type { PageDto, PersonDto, RoleDto } from '../api/types.ts'

const DEBOUNCE_MS = 300

export function People(): React.JSX.Element {
  const t = useT()
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')
  const [reviewedOnly, setReviewedOnly] = useState(false)
  const [page, setPage] = useState(1)
  const [data, setData] = useState<PageDto<PersonDto> | null>(null)
  const [error, setError] = useState(false)
  const [roles, setRoles] = useState<readonly RoleDto[] | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [roleToAssign, setRoleToAssign] = useState('')
  const [assignMessage, setAssignMessage] = useState<string | null>(null)
  const requestGeneration = useRef(0)

  // Page reset lives in these two event handlers, not in an effect keyed on [q, reviewedOnly]:
  // a filter change reads as a new search, and setState-in-an-effect is the pattern
  // react-hooks/set-state-in-effect exists to catch.
  useEffect(() => {
    const id = setTimeout(() => { setQ(qInput); setPage(1) }, DEBOUNCE_MS)
    return () => { clearTimeout(id) }
  }, [qInput])

  function setReviewedFilter(checked: boolean): void {
    setReviewedOnly(checked)
    setPage(1)
  }

  useEffect(() => {
    // A generation counter, not an AbortController: client.ts's api.get takes no signal, and a
    // stale response arriving after a newer request must not overwrite what it fetched.
    const generation = ++requestGeneration.current
    const params = new URLSearchParams({ page: String(page) })
    if (q !== '') params.set('q', q)
    if (reviewedOnly) params.set('reviewed', 'false')
    api.get<PageDto<PersonDto>>(`/api/people?${params.toString()}`).then(
      (d) => { if (generation === requestGeneration.current) { setData(d); setError(false) } },
      () => { if (generation === requestGeneration.current) setError(true) },
    )
  }, [page, q, reviewedOnly])

  useEffect(() => {
    api.get<readonly RoleDto[]>('/api/roles').then((r) => { setRoles(r) }, () => undefined)
  }, [])

  function toggleSelect(id: string, checked: boolean): void {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id); else next.delete(id)
      return next
    })
  }

  async function bulkAssign(): Promise<void> {
    if (roleToAssign === '' || selected.size === 0) return
    const ids = [...selected]
    const start = performance.now()
    const results = await Promise.allSettled(
      ids.map((personId) => api.send('POST', `/api/people/${personId}/roles`, { role: roleToAssign })),
    )
    const seconds = ((performance.now() - start) / 1000).toFixed(1)
    const ok = results.filter((r) => r.status === 'fulfilled').length
    setAssignMessage(t('people.assigned', { ok, total: ids.length, seconds }))
    setSelected(new Set())
  }

  const items = readArray<PersonDto>(data?.items) ?? []
  const total = data?.total ?? 0
  const perPage = data?.perPage ?? 1
  const pages = Math.max(1, Math.ceil(total / perPage))
  const roleList = readArray<RoleDto>(roles) ?? []

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-medium">{t('people.title')}</h1>
      {error && <p role="alert" className="text-sm text-crit">{t('error.generic')}</p>}

      <div className="flex flex-wrap items-end gap-3">
        <label className="block space-y-1 text-sm">
          <span className="text-xs text-text/60">{t('people.search')}</span>
          <input
            value={qInput}
            onChange={(e) => { setQInput(e.target.value) }}
            className="w-full rounded-md border border-line bg-surface px-2 py-1"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={reviewedOnly}
            onChange={(e) => { setReviewedFilter(e.target.checked) }}
          />
          {t('people.neverReviewed')}
        </label>
      </div>

      {data !== null && (
        <>
          <p className="text-sm text-text/60">{t('people.total', { total })}</p>
          <ul className="divide-y divide-line-soft rounded-lg border border-line">
            {items.map((person) => (
              <li key={person.id} className="flex flex-wrap items-center gap-3 p-3">
                <input
                  type="checkbox"
                  aria-label={person.displayName ?? person.id}
                  checked={selected.has(person.id)}
                  onChange={(e) => { toggleSelect(person.id, e.target.checked) }}
                />
                <Link to={`/people/${person.id}`} className="min-w-0 flex-1">
                  <span className="font-medium">{person.displayName ?? person.id}</span>
                  {!person.reviewed && (
                    <span className="ml-2 rounded-full bg-warn-bg px-2 py-0.5 text-xs text-warn">
                      {t('people.neverReviewed')}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => { setPage((p) => Math.max(1, p - 1)) }}
              disabled={page <= 1}
              className="rounded-md border border-line px-3 py-1.5 text-sm disabled:opacity-40"
            >
              {t('people.previous')}
            </button>
            <span className="text-sm text-text/60">{t('people.page', { page, pages })}</span>
            <button
              type="button"
              onClick={() => { setPage((p) => Math.min(pages, p + 1)) }}
              disabled={page >= pages}
              className="rounded-md border border-line px-3 py-1.5 text-sm disabled:opacity-40"
            >
              {t('people.next')}
            </button>
          </div>
        </>
      )}

      {selected.size > 0 && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-line p-3">
          <span className="text-sm">{t('people.selected', { count: selected.size })}</span>
          <label className="block space-y-1 text-sm">
            <span className="text-xs text-text/60">{t('people.role')}</span>
            <select
              value={roleToAssign}
              onChange={(e) => { setRoleToAssign(e.target.value) }}
              className="rounded-md border border-line bg-surface px-2 py-1"
            >
              <option value="">—</option>
              {roleList.map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}
            </select>
          </label>
          <button
            type="button"
            onClick={() => { void bulkAssign() }}
            disabled={roleToAssign === ''}
            className="rounded-md bg-accent px-3 py-2 text-accent-ink"
          >
            {t('people.assign')}
          </button>
        </div>
      )}
      {assignMessage !== null && <p role="alert" className="text-sm">{assignMessage}</p>}
    </div>
  )
}
