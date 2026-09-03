import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api } from '../api/client.ts'
import { readArray } from '../api/read.ts'
import { ORDER } from '../api/types.ts'
import { Breadcrumb } from '../components/Breadcrumb.tsx'
import { EmptyState } from '../components/EmptyState.tsx'
import { TONE_CLASSES } from '../components/tone.ts'
import { useT } from '../i18n.tsx'
import { isNewerStrain } from '../strains.ts'
import type { PluginDto, PluginGroups, SourceDto, SporeOffer } from '../api/types.ts'
import type { StringKey } from '../../locales/en.ts'

const PER_PAGE = 25

/**
 * Grouping the rows by kind is dropped: `SporeOffer` is `{name, strain}` and the kind lives
 * behind one `driver.detail()` call per spore — 61 requests for a set of headers (brief §7,
 * task 18 step 5).
 */
function OfferRow(
  { id, offer, here }: { id: string, offer: SporeOffer, here: PluginDto | null | undefined },
): React.JSX.Element {
  const t = useT()
  // `undefined` is "the join answered and does not know this name"; `null` is "the join was
  // refused", which must say nothing rather than claim it is not installed.
  const note = here === null
    ? null
    : here === undefined
      ? { text: t('browse.notInstalled'), tone: 'idle' as const }
      : isNewerStrain(offer.strain, here.strain ?? '')
        ? { text: t('browse.update', { strain: here.strain ?? '' }), tone: 'ok' as const }
        : { text: t('browse.installedState', { state: t(`state.${here.state}` as StringKey).toLowerCase() }), tone: 'idle' as const }

  return (
    <li
      data-testid={`offer-${offer.name}`}
      className="grid items-baseline gap-x-3 gap-y-1 p-3 md:grid-cols-[minmax(0,2fr)_6rem_minmax(0,2fr)]"
    >
      <Link to={`/sources/${id}/spores/${offer.name}`} className="truncate font-mono">{offer.name}</Link>
      <span className="font-mono text-meta-lg text-text/60">{offer.strain}</span>
      {note !== null && <span className={`text-body ${TONE_CLASSES[note.tone].text}`}>{note.text}</span>}
    </li>
  )
}

export function BrowseSource(): React.JSX.Element {
  const t = useT()
  const { id = '' } = useParams()
  const [source, setSource] = useState<SourceDto | null>(null)
  const [offers, setOffers] = useState<readonly SporeOffer[] | null>(null)
  const [groups, setGroups] = useState<PluginGroups | null>(null)
  const [sourceError, setSourceError] = useState(false)
  const [offersError, setOffersError] = useState(false)
  const [term, setTerm] = useState('')
  const [shown, setShown] = useState(PER_PAGE)

  useEffect(() => {
    api.get<SourceDto>(`/api/sources/${id}`).then(
      (v) => { setSource(v); setSourceError(false) },
      () => { setSourceError(true) },
    )
    api.get<readonly SporeOffer[]>(`/api/sources/${id}/spores`).then(
      (v) => { setOffers(v); setOffersError(false) },
      () => { setOffersError(true) },
    )
    api.get<PluginGroups>('/api/plugins').then((v) => { setGroups(v) }, () => { setGroups(null) })
  }, [id])

  const all = readArray<SporeOffer>(offers) ?? []
  const installed = groups === null
    ? null
    : new Map(ORDER.flatMap((kind) => readArray<PluginDto>(groups[kind]) ?? []).map((p) => [p.name, p]))
  const needle = term.trim().toLowerCase()
  const matched = needle === '' ? all : all.filter((o) => o.name.toLowerCase().includes(needle))
  const visible = matched.slice(0, shown)

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <header className="space-y-1">
          <Breadcrumb trail={[{ label: t('sources.title'), to: '/sources' }]} />
          <h1 className="font-mono text-page">{source?.label ?? ''}</h1>
          {offers !== null && (
            <p className="text-meta-lg text-text/60">{t('sources.catalogue', { count: all.length })}</p>
          )}
        </header>
        {offers !== null && all.length > 0 && (
          <input
            type="search"
            value={term}
            aria-label={t('browse.search')}
            placeholder={t('browse.search')}
            onChange={(e) => { setTerm(e.target.value); setShown(PER_PAGE) }}
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-body md:w-70"
          />
        )}
      </div>

      {/* Priority, not both: a missing source (a stale bookmark, deleted elsewhere) is a
          different fault than a live one that cannot be reached, and only one alert renders. */}
      {sourceError && <p role="alert" className={`text-body ${TONE_CLASSES.warn.text}`}>{t('error.generic')}</p>}
      {!sourceError && offersError && (
        <p role="alert" className={`text-body ${TONE_CLASSES.warn.text}`}>{t('sources.unreachable')}</p>
      )}

      {!sourceError && !offersError && offers !== null && (
        matched.length === 0
          ? (
            <EmptyState
              title={needle === '' ? t('browse.empty') : t('browse.noMatch', { term: term.trim() })}
              body={needle === '' ? t('browse.emptyLead') : t('browse.noMatchLead')}
            />
          )
          : (
            <>
              <ul className="divide-y divide-line-soft rounded-lg border border-line">
                {visible.map((offer) => (
                  <OfferRow key={offer.name} id={id} offer={offer} here={installed === null ? null : installed.get(offer.name)} />
                ))}
              </ul>
              {matched.length > PER_PAGE && (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-meta-lg text-text/60">
                    {t('paging.showing', { from: 1, to: visible.length, total: matched.length })}
                  </p>
                  {visible.length < matched.length && (
                    <button
                      type="button"
                      onClick={() => { setShown((n) => n + PER_PAGE) }}
                      className="rounded-md border border-line px-3 py-2 text-body"
                    >
                      {t('browse.loadMore', { count: PER_PAGE })}
                    </button>
                  )}
                </div>
              )}
            </>
          )
      )}
    </div>
  )
}
