import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { ApiError, api } from '../api/client.ts'
import { readArray } from '../api/read.ts'
import { Breadcrumb } from '../components/Breadcrumb.tsx'
import { Chip } from '../components/Chip.tsx'
import { DemandsList } from '../components/DemandsList.tsx'
import { DormantDiagnosis } from '../components/DormantDiagnosis.tsx'
import { EmptyState } from '../components/EmptyState.tsx'
import { StateBadge } from '../components/StateBadge.tsx'
import { Tabs } from '../components/Tabs.tsx'
import { TONE_CLASSES } from '../components/tone.ts'
import { useHealth } from '../health.tsx'
import { plural, useT } from '../i18n.tsx'
import { kindLabel, pluginTrail } from '../kinds.ts'
import { faultOf } from '../rhizaHealth.ts'
import type { MutationResult, PluginDetailDto } from '../api/types.ts'
import type { Tab } from '../components/Tabs.tsx'

const PANELS = ['diagnosis', 'requirements', 'commands'] as const
type Panel = typeof PANELS[number]

function panelOf(requested: string | null): Panel {
  return PANELS.find((p) => p === requested) ?? 'diagnosis'
}

export function PluginDetail(): React.JSX.Element {
  const t = useT()
  const { name = '' } = useParams()
  const { health, refresh } = useHealth()
  const [plugin, setPlugin] = useState<PluginDetailDto | null>(null)
  const [error, setError] = useState(false)
  // In the query string, not in state: the sibling settings screen's own tab strip links here,
  // and three links to one href all landed on the diagnosis panel.
  const [params, setParams] = useSearchParams()
  const panel = panelOf(params.get('panel'))
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // A ref, not `busy`: two clicks in one tick read the same render's state, and a second POST
  // lands on a substrate already mid-restart.
  const inFlight = useRef(false)

  // A callback, not an inline effect: a POST that changes the plugin's state must re-read the
  // DTO, or the header keeps describing what the action just changed.
  const load = useCallback((): Promise<void> => api.get<PluginDetailDto>(`/api/plugins/${name}`).then(
    (v) => { setPlugin(v); setError(false) },
    () => { setError(true) },
  ), [name])

  useEffect(() => { void load() }, [load])

  const commands = readArray<string>(plugin?.commands)
  const mounted = readArray<string>(plugin?.mounted)

  function run(path: string): void {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    const settle = (message: string | null): void => {
      setActionError(message)
      setBusy(false)
      inFlight.current = false
    }
    api.send<MutationResult>('POST', path).then(
      () => Promise.all([refresh(), load()]).then(() => { settle(null) }),
      (e: unknown) => { settle(e instanceof ApiError ? e.message : t('error.generic')) },
    ).catch(() => { settle(t('error.generic')) })
  }

  if (plugin === null) {
    return (
      <div className="space-y-6">
        {error && <p role="alert" className={`text-body ${TONE_CLASSES.warn.text}`}>{t('error.generic')}</p>}
      </div>
    )
  }

  const dormant = plugin.state === 'dormant'
  // finding F17: the page an operator opens to diagnose a plugin was the least informed
  // surface in the SPA — /api/plugins knows germination's verdict, never the live probe's.
  const fault = faultOf(health, plugin.name)
  const declared = commands ?? []
  const tabs: readonly Tab[] = [
    { id: 'diagnosis', label: t('detail.tabDiagnosis') },
    { id: 'configuration', label: t('detail.tabConfiguration'), to: `/plugins/${plugin.name}/settings` },
    { id: 'requirements', label: t('detail.tabRequirements') },
    { id: 'commands', label: t('detail.tabCommands'), count: declared.length },
  ]
  const trail = pluginTrail(t, plugin.name, plugin.kind)

  return (
    <div className="space-y-4">
      <Breadcrumb trail={trail} />

      <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-page">{plugin.name}</h1>
            <StateBadge state={fault?.state ?? plugin.state} />
          </div>
          {fault?.detail !== undefined && (
            <p className={`font-mono text-body ${TONE_CLASSES.warn.text}`}>{fault.detail}</p>
          )}
          {plugin.description !== undefined && (
            <p className="text-body text-text/70">{plugin.description}</p>
          )}
          <div className="flex flex-wrap gap-2">
            {plugin.kind !== undefined && <Chip label={kindLabel(t, plugin.kind)} />}
            {plugin.strain !== undefined && <Chip label={`strain ${plugin.strain}`} />}
            <Chip label={t(plugin.enabled ? 'detail.enabled' : 'detail.disabled')} />
            <Chip
              label={plural(t, 'detail.commandCount', declared.length, {
                count: declared.length,
              })}
            />
            {/* design §7.4: an operator asked "where do I configure Signal?" needs this even
                for a plugin nobody installed through a source. */}
            <Chip label={plugin.source ?? t('plugins.source.local')} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* Only while degraded: api/routes/health.ts refuses the retry otherwise, so the
              button would answer api.germinationNotDegraded and nothing else. */}
          {health?.mode === 'degraded' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => { run('/api/germination/retry') }}
              className="rounded-md border border-line px-3 py-2 text-body disabled:opacity-60"
            >
              {t('detail.retry')}
            </button>
          )}
          {plugin.enabled && (
            <button
              type="button"
              disabled={busy}
              onClick={() => { run(`/api/plugins/${plugin.name}/disable`) }}
              className="rounded-md border border-line px-3 py-2 text-body disabled:opacity-60"
            >
              {t('detail.disableAction')}
            </button>
          )}
        </div>
      </header>

      {actionError !== null && (
        <p role="alert" className={`text-body ${TONE_CLASSES.warn.text}`}>{actionError}</p>
      )}

      {/* replace, not push: a tab is a view of one screen, not a page in the reader's trail. */}
      <Tabs tabs={tabs} active={panel} onSelect={(id) => { setParams({ panel: id }, { replace: true }) }} />

      {panel === 'diagnosis' && (
        <div className="space-y-4">
          {dormant && plugin.reason !== undefined && (
            <DormantDiagnosis name={plugin.name} reason={plugin.reason} />
          )}

          {dormant && declared.length > 0 && (
            <section className="space-y-2 rounded-xl border border-line bg-surface p-4">
              <h2 className="text-title font-medium">{t('detail.unavailable')}</h2>
              <ul className="space-y-1 font-mono text-body">
                {declared.map((c) => <li key={c}>{c}</li>)}
              </ul>
              <p className="text-body text-text/70">
                {plural(t, 'detail.unavailableLead', declared.length, {
                  count: declared.length,
                })}
              </p>
            </section>
          )}

          {mounted !== undefined && (
            <section className="space-y-2 rounded-xl border border-line bg-surface p-4">
              <h2 className="text-title font-medium">{t('detail.mounted')}</h2>
              <ul className="space-y-1 font-mono text-body">
                {mounted.map((s) => <li key={s}>{s}</li>)}
              </ul>
            </section>
          )}

          {/* A true statement about this runtime, not a placeholder: germination refuses the
              plugin before its code loads, so no log of the attempt exists to show. */}
          {dormant && (
            <section className="space-y-1 rounded-xl border border-line bg-surface p-4">
              <h2 className="text-title font-medium text-text/70">{t('detail.noLog')}</h2>
              <p className="text-body text-text/60">{t('detail.noLogLead')}</p>
            </section>
          )}
        </div>
      )}

      {panel === 'requirements' && plugin.demands !== undefined && (
        <section className="space-y-2">
          <h2 className="text-title font-medium">{t('detail.declared')}</h2>
          <DemandsList demands={plugin.demands} />
        </section>
      )}

      {panel === 'commands' && (
        <section className="space-y-2">
          <h2 className="text-title font-medium">{t('detail.commands')}</h2>
          {declared.length === 0
            ? <EmptyState title={t('detail.noCommandsTitle')} body={t('detail.noCommands')} />
            : (
              <ul className="space-y-1 font-mono text-body">
                {declared.map((c) => <li key={c}>{c}</li>)}
              </ul>
            )}
        </section>
      )}
    </div>
  )
}
