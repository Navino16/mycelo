import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { api } from '../api/client.ts'
import { readArray } from '../api/read.ts'
import type { InoculateOutcome, SourceDto, SporeStrainsDto } from '../api/types.ts'
import { DemandsList } from '../components/DemandsList.tsx'
import { useT } from '../i18n.tsx'

export function TrustNotice({ official }: { official: boolean }): React.JSX.Element | null {
  const t = useT()
  if (official) return null
  return (
    <p role="note" className="rounded-lg border border-warn bg-warn-bg p-3 text-sm">
      {t('spore.trust')}
    </p>
  )
}

export function SporeDetail(): React.JSX.Element {
  const t = useT()
  const { id = '', name = '' } = useParams()
  const [spore, setSpore] = useState<SporeStrainsDto['detail'] | null>(null)
  const [source, setSource] = useState<SourceDto | null>(null)
  const [outcome, setOutcome] = useState<InoculateOutcome | null>(null)
  // Two independent fetches: a shared boolean set by both would race if one resolves after
  // the other, so each keeps its own flag and the alert is their union.
  const [sporeError, setSporeError] = useState(false)
  const [sourceError, setSourceError] = useState(false)
  const [installError, setInstallError] = useState<string | null>(null)
  const error = sporeError || sourceError

  useEffect(() => {
    api.get<SporeStrainsDto>(`/api/sources/${id}/spores/${name}`).then(
      (v) => { setSpore(v.detail); setSporeError(false) },
      () => { setSporeError(true) },
    )
    api.get<SourceDto>(`/api/sources/${id}`).then(
      (v) => { setSource(v); setSourceError(false) },
      () => { setSourceError(true) },
    )
  }, [id, name])

  const warnings = readArray<string>(outcome?.warnings) ?? []

  async function install(): Promise<void> {
    try {
      const result = await api.send<InoculateOutcome>('POST', `/api/sources/${id}/inoculate`, { name })
      setOutcome(result)
      setInstallError(null)
    } catch (e) {
      setInstallError(e instanceof Error ? e.message : t('error.generic'))
    }
  }

  return (
    <div className="space-y-5">
      {error && <p role="alert" className="text-sm text-crit">{t('error.generic')}</p>}

      {spore !== null && source !== null && (
        <>
          <header className="space-y-1">
            <h1 className="font-mono text-xl">{spore.name}</h1>
            <p className="text-sm text-text/70">{spore.description}</p>
            <p className="text-xs text-text/60">{t('spore.septum', { range: spore.septum })}</p>
          </header>

          <TrustNotice official={source.official} />

          <section className="space-y-2">
            <h2 className="font-medium">{t('detail.declared')}</h2>
            <DemandsList demands={spore.demands} />
          </section>

          {outcome === null
            ? (
              <button
                type="button"
                onClick={() => { void install() }}
                className="rounded-md bg-accent px-3 py-2 text-accent-ink"
              >
                {t('spore.install')}
              </button>
            )
            : (
              <div className="space-y-2 rounded-lg border border-ok bg-ok-bg p-3">
                <p>{t('spore.installed', { strain: outcome.strain })}</p>
                {warnings.map((w) => (
                  <p key={w} className="text-sm text-text/80">{w}</p>
                ))}
              </div>
            )}
          {installError !== null && <p role="alert" className="text-sm text-crit">{installError}</p>}
        </>
      )}
    </div>
  )
}
