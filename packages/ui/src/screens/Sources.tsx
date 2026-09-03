import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api, ApiError } from '../api/client.ts'
import { readArray } from '../api/read.ts'
import { Chip } from '../components/Chip.tsx'
import { Sheet } from '../components/Sheet.tsx'
import { TONE_CLASSES } from '../components/tone.ts'
import { useT } from '../i18n.tsx'
import type { SourceDto, SporeOffer } from '../api/types.ts'
import type { StringKey } from '../../locales/en.ts'

interface Draft { label: string, location: string, token: string }

function badgeKey(source: SourceDto): StringKey {
  if (!source.enabled) return 'sources.disabled'
  return source.official ? 'sources.official' : 'sources.thirdParty'
}

function Field(
  { id, label, value, onChange, type, hint }: {
    id: string
    label: string
    value: string
    onChange: (next: string) => void
    type?: 'password'
    hint?: string
  },
): React.JSX.Element {
  return (
    <label className="block space-y-1" htmlFor={id}>
      <span className="text-meta-lg text-text/60">{label}</span>
      <input
        id={id}
        value={value}
        {...(type === undefined ? {} : { type, autoComplete: 'off' as const })}
        onChange={(e) => { onChange(e.target.value) }}
        className="w-full rounded-md border border-line bg-surface px-3 py-2 font-mono text-body"
      />
      {hint !== undefined && <span className="block text-meta-lg text-text/60">{hint}</span>}
    </label>
  )
}

/** The three fields both the add sheet and a row's edit sheet carry (2d-sources-mobile-add). */
function SourceForm(
  { draft, setDraft, onSubmit, error, tokenHint }: {
    draft: Draft
    setDraft: (next: Draft) => void
    onSubmit: () => void
    error: string | null
    tokenHint: boolean
  },
): React.JSX.Element {
  const t = useT()
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit() }}
      className="space-y-3"
    >
      <Field
        id="source-label"
        label={t('sources.label')}
        value={draft.label}
        onChange={(label) => { setDraft({ ...draft, label }) }}
      />
      <Field
        id="source-location"
        label={t('sources.location')}
        value={draft.location}
        onChange={(location) => { setDraft({ ...draft, location }) }}
      />
      <Field
        id="source-token"
        label={t('sources.token')}
        type="password"
        value={draft.token}
        onChange={(token) => { setDraft({ ...draft, token }) }}
        {...(tokenHint ? { hint: t('sources.tokenKept') } : {})}
      />
      {error !== null && <p role="alert" className={`text-body ${TONE_CLASSES.warn.text}`}>{error}</p>}
      <button type="submit" className="w-full rounded-md bg-accent px-3 py-2 font-medium text-accent-ink">
        {t('action.save')}
      </button>
    </form>
  )
}

function SourceRow(
  { source, spores, onEdit }: {
    source: SourceDto, spores: number | undefined, onEdit: () => void,
  },
): React.JSX.Element {
  const t = useT()
  return (
    <li
      data-testid={`source-${String(source.id)}`}
      className="grid items-baseline gap-x-3 gap-y-1 p-3 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_8rem_7rem_4rem]"
    >
      <Link to={`/sources/${String(source.id)}`} className="truncate font-mono font-medium">
        {source.label}
      </Link>
      <span className="truncate font-mono text-meta-lg text-text/60">{source.location}</span>
      <span className="justify-self-start">
        <Chip label={t(badgeKey(source))} tone={source.official && source.enabled ? 'ok' : 'idle'} />
      </span>
      <span className="text-body text-text/70">
        {spores === undefined
          ? ''
          : t(spores === 1 ? 'sources.catalogueOne' : 'sources.catalogue', { count: spores })}
      </span>
      <button
        type="button"
        onClick={onEdit}
        className="justify-self-start rounded-md border border-line px-2 py-1 text-meta-lg md:justify-self-end"
      >
        {t('sources.edit')}
      </button>
    </li>
  )
}

const BLANK: Draft = { label: '', location: '', token: '' }

export function Sources(): React.JSX.Element {
  const t = useT()
  const [sources, setSources] = useState<readonly SourceDto[] | null>(null)
  const [error, setError] = useState(false)
  const [counts, setCounts] = useState<Record<number, number>>({})
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<SourceDto | null>(null)
  const [draft, setDraft] = useState<Draft>(BLANK)
  const [formError, setFormError] = useState<string | null>(null)

  function count(id: number): void {
    api.get<readonly SporeOffer[]>(`/api/sources/${String(id)}/spores`).then(
      (offers) => { setCounts((prev) => ({ ...prev, [id]: (readArray<SporeOffer>(offers) ?? []).length })) },
      () => { /* an unreachable source shows no count and raises no error */ },
    )
  }

  function load(): void {
    api.get<readonly SourceDto[]>('/api/sources').then(
      (v) => {
        setSources(v); setError(false)
        // Fired once the list is in state and in parallel, never as a gate on it: one
        // unreachable source must not blank the page.
        for (const source of readArray<SourceDto>(v) ?? []) count(source.id)
      },
      () => { setError(true) },
    )
  }

  useEffect(load, [])

  const list = readArray<SourceDto>(sources) ?? []

  function openAdd(): void {
    setDraft(BLANK); setFormError(null); setEditing(null); setAdding(true)
  }

  function openEdit(source: SourceDto): void {
    setDraft({ label: source.label, location: source.location, token: source.token ?? '' })
    setFormError(null); setAdding(false); setEditing(source)
  }

  function fail(e: unknown): void {
    setFormError(e instanceof ApiError ? e.message : t('error.generic'))
  }

  function add(): void {
    api.send('POST', '/api/sources', {
      label: draft.label,
      driver: 'github',
      location: draft.location,
      ...(draft.token === '' ? {} : { token: draft.token }),
    }).then(
      () => { setAdding(false); setFormError(null); load() },
      fail,
    )
  }

  // Unlike `add`, this leaves the sheet open: the token field re-syncing to the stored mask
  // is the credential-safety behaviour, and it has to be visible to be trusted.
  function save(source: SourceDto): void {
    // A token still reading the mask is sent back verbatim: sources.ts skips a value equal to
    // it, so the stored credential survives untouched.
    api.send<SourceDto>('PATCH', `/api/sources/${String(source.id)}`, {
      label: draft.label, location: draft.location, token: draft.token,
    }).then(
      (updated) => {
        setSources((prev) => (prev ?? []).map((s) => (s.id === updated.id ? updated : s)))
        setDraft((prev) => ({ ...prev, token: updated.token ?? '' }))
        setFormError(null)
      },
      fail,
    )
  }

  // Withheld whenever one source has not answered, never under-summed: dropping an unknown
  // from the sum prints a wrong number with no marker (Roles gates its own summary the same way).
  const total = list.every((s) => counts[s.id] !== undefined)
    ? list.reduce((sum, s) => sum + (counts[s.id] ?? 0), 0)
    : undefined

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-page font-semibold">{t('sources.title')}</h1>
          {sources !== null && total !== undefined && (
            <p className="text-meta-lg text-text/60">
              {t(
                list.length === 1 ? 'sources.summaryOne' : 'sources.summary',
                { count: list.length, spores: total },
              )}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={openAdd}
          className="rounded-md bg-accent px-3 py-2 font-medium text-accent-ink"
        >
          {t('sources.add')}
        </button>
      </div>

      {error && <p role="alert" className={`text-body ${TONE_CLASSES.warn.text}`}>{t('error.generic')}</p>}

      {sources !== null && list.length > 0 && (
        <>
          <ul className="divide-y divide-line-soft rounded-lg border border-line">
            {list.map((source) => (
              <SourceRow
                key={source.id}
                source={source}
                spores={counts[source.id]}
                onEdit={() => { openEdit(source) }}
              />
            ))}
          </ul>
          {/* The honest version of the design's unreachable card: no probe route exists, so
              nothing here claims to know which source is down. */}
          <p className="text-body text-text/70">{t('sources.unreachableLead')}</p>
        </>
      )}

      <Sheet title={t('sources.addTitle')} open={adding} onClose={() => { setAdding(false) }}>
        <SourceForm draft={draft} setDraft={setDraft} onSubmit={add} error={formError} tokenHint={false} />
      </Sheet>
      <Sheet
        title={editing?.label ?? ''}
        open={editing !== null}
        onClose={() => { setEditing(null) }}
      >
        <SourceForm
          draft={draft}
          setDraft={setDraft}
          onSubmit={() => { if (editing !== null) save(editing) }}
          error={formError}
          tokenHint
        />
      </Sheet>
    </div>
  )
}
