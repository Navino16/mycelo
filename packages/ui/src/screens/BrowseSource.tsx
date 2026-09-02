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
  const [error, setError] = useState(false)

  useEffect(() => {
    // A source's own row cannot fail to be read (it never touches the network); the listing
    // below is what a bad location or token actually breaks (design §8).
    api.get<SourceDto>(`/api/sources/${id}`).then(setSource, () => undefined)
    api.get<readonly SporeOffer[]>(`/api/sources/${id}/spores`).then(
      (v) => { setOffers(v); setError(false) },
      () => { setError(true) },
    )
  }, [id])

  const list = readArray<SporeOffer>(offers) ?? []

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-medium">{t('browse.title', { source: source?.label ?? '' })}</h1>
      {error && <p role="alert" className="text-sm text-crit">{t('sources.unreachable')}</p>}
      {!error && offers !== null && (
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
