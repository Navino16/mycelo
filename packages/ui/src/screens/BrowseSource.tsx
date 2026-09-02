import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api } from '../api/client.ts'
import { readArray } from '../api/read.ts'
import type { SourceDto, SporeOffer } from '../api/types.ts'
import { useT } from '../i18n.tsx'

export function BrowseSource(): React.JSX.Element {
  const t = useT()
  const { id = '' } = useParams()
  const [source, setSource] = useState<SourceDto | null>(null)
  const [offers, setOffers] = useState<readonly SporeOffer[] | null>(null)
  const [sourceError, setSourceError] = useState(false)
  const [offersError, setOffersError] = useState(false)

  useEffect(() => {
    api.get<SourceDto>(`/api/sources/${id}`).then(
      (v) => { setSource(v); setSourceError(false) },
      () => { setSourceError(true) },
    )
    api.get<readonly SporeOffer[]>(`/api/sources/${id}/spores`).then(
      (v) => { setOffers(v); setOffersError(false) },
      () => { setOffersError(true) },
    )
  }, [id])

  const list = readArray<SporeOffer>(offers) ?? []

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-medium">{t('browse.title', { source: source?.label ?? '' })}</h1>
      {/* Priority, not both: a missing source (a stale bookmark, deleted elsewhere) is a
          different fault than a live one that cannot be reached, and only one alert renders. */}
      {sourceError && <p role="alert" className="text-sm text-crit">{t('error.generic')}</p>}
      {!sourceError && offersError && <p role="alert" className="text-sm text-crit">{t('sources.unreachable')}</p>}
      {!sourceError && !offersError && offers !== null && (
        list.length === 0
          ? <p className="text-sm text-text/60">{t('browse.empty')}</p>
          : (
            <ul className="divide-y divide-line-soft rounded-lg border border-line">
              {list.map((offer) => (
                <li key={offer.name} className="flex items-center justify-between gap-3 p-3">
                  <Link to={`/sources/${id}/spores/${offer.name}`} className="font-mono">{offer.name}</Link>
                  <span className="text-xs text-text/60">{offer.strain}</span>
                </li>
              ))}
            </ul>
          )
      )}
    </div>
  )
}
