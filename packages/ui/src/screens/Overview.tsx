import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api } from '../api/client.ts'
import { readArray } from '../api/read.ts'
import { ORDER } from '../api/types.ts'
import { useUptimeLine } from '../chrome.tsx'
import { AttentionTable } from '../components/AttentionTable.tsx'
import { Chip } from '../components/Chip.tsx'
import { Dot } from '../components/Dot.tsx'
import { EmptyState } from '../components/EmptyState.tsx'
import { GuidedStart } from '../components/GuidedStart.tsx'
import { MuteTakeover } from '../components/MuteTakeover.tsx'
import { ProportionBar } from '../components/ProportionBar.tsx'
import { Tile } from '../components/Tile.tsx'
import { TONE_CLASSES } from '../components/tone.ts'
import { useHealth } from '../health.tsx'
import { useT } from '../i18n.tsx'
import { healthPillState } from '../shell/HealthPill.tsx'
import type { AttentionRow } from '../components/AttentionTable.tsx'
import type { Segment } from '../components/ProportionBar.tsx'
import type { SubstrateCounts } from '../components/GuidedStart.tsx'
import type { Tone } from '../components/tone.ts'
import type {
  CommandDto, ConfigDto, PluginDto, PluginGroups, RhizaHealth, RoleDto, SourceDto,
} from '../api/types.ts'

type Translate = ReturnType<typeof useT>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `total` off a PageDto, guarding a shape that crossed the boundary unchecked. */
function pageTotal(value: unknown): number {
  const total = isRecord(value) ? value.total : undefined
  return typeof total === 'number' ? total : 0
}

interface Body {
  guided: SubstrateCounts
  plugins: readonly PluginDto[]
  commands: readonly CommandDto[]
  germinated: number
  dormant: number
  disabled: number
  /** Commands declared by plugins that did not start (PluginDto.commands, task 14). */
  unavailable: number
  people: number
  neverReviewed: number
  roles: number
  sources: number
  defaultRole: string | undefined
}

function readBody(answers: readonly unknown[]): Body {
  const [rawPlugins, rawSources, rawRoles, rawCommands, rawConfig, rawPeople, rawUnreviewed] = answers
  const groups = isRecord(rawPlugins) ? rawPlugins as unknown as PluginGroups : undefined
  const plugins = ORDER.flatMap((kind) => readArray<PluginDto>(groups?.[kind]) ?? [])
  const roles = readArray<RoleDto>(rawRoles) ?? []
  const commandGroups = isRecord(rawCommands) ? Object.values(rawCommands) : []
  const stopped = plugins.filter((p) => p.state !== 'germinated')
  return {
    guided: {
      sources: (readArray<SourceDto>(rawSources) ?? []).length,
      channels: (readArray<PluginDto>(groups?.hypha) ?? []).length,
      customRoles: roles.filter((r) => !r.builtin).length,
    },
    plugins,
    commands: commandGroups.flatMap((group) => readArray<CommandDto>(group) ?? []),
    germinated: plugins.filter((p) => p.state === 'germinated').length,
    dormant: plugins.filter((p) => p.state === 'dormant').length,
    disabled: plugins.filter((p) => p.state === 'disabled').length,
    unavailable: stopped.reduce((sum, p) => sum + (readArray<string>(p.commands) ?? []).length, 0),
    people: pageTotal(rawPeople),
    neverReviewed: pageTotal(rawUnreviewed),
    roles: roles.length,
    sources: (readArray<SourceDto>(rawSources) ?? []).length,
    defaultRole: (rawConfig as ConfigDto | null | undefined)?.defaultRole,
  }
}

export function Overview(): React.JSX.Element {
  const t = useT()
  const { health, error, refresh } = useHealth()
  const uptime = useUptimeLine()
  const [body, setBody] = useState<Body | null>(null)
  const [bodyError, setBodyError] = useState(false)
  const [filter, setFilter] = useState<'all' | 'dormant' | 'unreachable'>('all')
  // Seconds since the poll that last answered. The substrate serves no check timestamp
  // (§2 1a), and setState directly in an effect is refused by react-hooks/set-state-in-effect,
  // so the age is re-derived by the interval and starts at the render that mounted it.
  const [age, setAge] = useState(0)

  useEffect(() => {
    Promise.all([
      api.get<unknown>('/api/plugins'),
      api.get<unknown>('/api/sources'),
      api.get<unknown>('/api/roles'),
      api.get<unknown>('/api/commands'),
      api.get<unknown>('/api/config'),
      api.get<unknown>('/api/people?perPage=1'),
      api.get<unknown>('/api/people?reviewed=false&perPage=1'),
    ]).then((answers) => {
      setBody(readBody(answers))
      setBodyError(false)
    }, () => { setBodyError(true) })
  }, [])

  useEffect(() => {
    if (health === null) return undefined
    const at = Date.now()
    const timer = setInterval(() => { setAge(Math.floor((Date.now() - at) / 1_000)) }, 1_000)
    return () => { clearInterval(timer) }
  }, [health])

  const dormant = readArray<{ name: string, reason: string }>(health?.dormant)
  const enforcingBlocked = readArray<string>(health?.enforcingBlocked)
  const rhizas = readArray<RhizaHealth>(health?.rhizas)
  // status is HealthStatus, not a bare string (api/types.ts): a 'degraded' or 'unreachable'
  // rhiza is a connector the operator needs to see, so both are grouped as one problem list.
  const degradedRhizas = rhizas?.filter((r) => r.status.state !== 'healthy') ?? []

  const unreadable = health !== null
    && (dormant === undefined || enforcingBlocked === undefined || rhizas === undefined)

  // mode is the gate, not just the arrays: germination.ts leaves them all [] on every failure
  // mode, so without this "Everything is germinated." rendered above the failure banner.
  const allWell = health?.mode === 'germinated' && !unreadable
    && (dormant?.length ?? 0) === 0 && degradedRhizas.length === 0
    && (enforcingBlocked?.length ?? 0) === 0

  const { state } = healthPillState(health, error)
  const rows = attentionRows(t, dormant ?? [], degradedRhizas, body)
  const shown = rows.filter((row) => (
    filter === 'all' || (filter === 'dormant' ? row.state === 'dormant' : row.state !== 'dormant')
  ))

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          {/* 1a-mobile titles the screen `Substrate`, 1a-desktop `Overview`; the shell header
              carries neither (task 15), so the one <h1> reads as whichever is visible. */}
          <h1 className="text-page font-semibold">
            <span className="md:hidden">{t('substrate.title')}</span>
            <span className="hidden md:inline">{t('overview.title')}</span>
          </h1>
          {uptime !== null && <p className="font-mono text-meta-lg text-text/60">{uptime}</p>}
        </div>
        {state !== 'mute' && <Search plugins={body?.plugins ?? []} commands={body?.commands ?? []} />}
      </div>

      {state === 'offline' && (
        <p role="alert" className={`text-body ${TONE_CLASSES.warn.text}`}>{t('error.offline')}</p>
      )}
      {bodyError && (
        <p role="alert" className={`text-body ${TONE_CLASSES.warn.text}`}>{t('error.generic')}</p>
      )}
      {unreadable && (
        <div role="alert" className={`space-y-1 rounded-lg border p-3 ${TONE_CLASSES.warn.border} ${TONE_CLASSES.warn.bg}`}>
          <p className={`font-medium ${TONE_CLASSES.warn.text}`}>{t('overview.unreadable')}</p>
          {/* Absent is not empty: a payload that never said whether traffic is blocked must say
              so in those words, or a mute bot reads as one more odd shape. */}
          {enforcingBlocked === undefined && (
            <p className="text-body">{t('health.blocked.unknown')}</p>
          )}
        </div>
      )}

      {state === 'mute'
        ? (
            <MuteTakeover
              names={enforcingBlocked ?? []}
              blocked={Number.isFinite(health?.blockedSinceBoot) ? Number(health?.blockedSinceBoot) : 0}
            />
          )
        : (
            <>
              {/* Renders alongside the health body, not instead of it: a fresh substrate's first
                  spores go dormant for missing configuration while steps are still outstanding,
                  and the operator must see both (whole-branch fix brief, item 2). */}
              {body !== null && <GuidedStart counts={body.guided} />}

              <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
                <HealthCard body={body} systemsDown={degradedRhizas.length} />
                <div className="grid grid-cols-2 gap-3">
                  <Tile
                    label={t('tile.people')}
                    value={body === null ? '—' : String(body.people)}
                    note={body !== null && body.neverReviewed > 0
                      ? t('tile.peopleNote', { count: body.neverReviewed })
                      : undefined}
                    noteTone="warn"
                  />
                  <Tile
                    label={t('tile.commands')}
                    value={body === null ? '—' : String(body.commands.length)}
                    note={body !== null && body.unavailable > 0
                      ? t('tile.commandsNote', { count: body.unavailable })
                      : undefined}
                    noteTone="warn"
                  />
                  <Tile
                    label={t('tile.roles')}
                    value={body === null ? '—' : String(body.roles)}
                    note={body === null
                      ? undefined
                      : body.defaultRole === undefined
                        ? t('tile.rolesNoteNone')
                        : t('tile.rolesNote', { role: body.defaultRole })}
                  />
                  <Tile label={t('tile.sources')} value={body === null ? '—' : String(body.sources)} />
                </div>
              </div>

              {/* != null, not !== undefined: a malformed 'failure: null' is not a shape health.ts
                  (packages/core/src/supervision/health.ts:29) can send today, but '.message' on a
                  bare null would crash the same way rhizas.filter did — cheap to close while here. */}
              {health?.mode === 'degraded' && health.failure != null && (
                <div
                  data-testid="germination-failure"
                  className={`rounded-lg border p-3 ${TONE_CLASSES.warn.border} ${TONE_CLASSES.warn.bg}`}
                >
                  <p className={`font-medium ${TONE_CLASSES.warn.text}`}>{t('health.degraded.title')}</p>
                  <p className="font-mono text-body">{health.failure.message}</p>
                </div>
              )}

              {rows.length > 0 && (
                <section className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-baseline gap-3">
                      <h2 className="text-title font-medium">
                        {`${t('overview.attention')} · ${String(rows.length)}`}
                      </h2>
                      <p className="font-mono text-meta text-text/60">
                        {t('overview.checked', { seconds: age })}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Chip
                        label={t('filter.all')}
                        active={filter === 'all'}
                        onClick={() => { setFilter('all') }}
                      />
                      <Chip
                        label={t('filter.dormant')}
                        count={rows.filter((r) => r.state === 'dormant').length}
                        tone="warn"
                        active={filter === 'dormant'}
                        onClick={() => { setFilter('dormant') }}
                      />
                      <Chip
                        label={t('filter.unreachable')}
                        count={rows.filter((r) => r.state !== 'dormant').length}
                        tone="warn"
                        active={filter === 'unreachable'}
                        onClick={() => { setFilter('unreachable') }}
                      />
                    </div>
                  </div>
                  <AttentionTable rows={shown} />
                </section>
              )}

              {allWell && (
                <EmptyState
                  title={t('overview.allWell')}
                  body={t('overview.allWellLead')}
                  action={(
                    <button
                      type="button"
                      onClick={() => { void refresh() }}
                      className="rounded-md border border-line px-3 py-1.5 text-body"
                    >
                      {t('overview.recheck')}
                    </button>
                  )}
                />
              )}
            </>
          )}
    </div>
  )
}

/** DormantDiagnosis's first cause, which is the one row action with a route behind it (§3). */
function configAction(t: Translate, name: string, reason: string): AttentionRow['action'] {
  if (!/configuration rejected|configuration is incomplete/i.test(reason)) return undefined
  return { to: `/plugins/${name}/settings`, label: t('dormant.fixConfig') }
}

function attentionRows(
  t: Translate,
  dormant: readonly { name: string, reason: string }[],
  rhizas: readonly RhizaHealth[],
  body: Body | null,
): readonly AttentionRow[] {
  const plugins: readonly AttentionRow[] = dormant.map((d) => ({
    name: d.name,
    // health.dormant carries no kind; /api/plugins does.
    kind: body?.plugins.find((p) => p.name === d.name)?.kind,
    state: 'dormant',
    reason: d.reason,
    action: configAction(t, d.name, d.reason),
  }))
  const systems: readonly AttentionRow[] = rhizas.map((r) => ({
    name: r.rhiza,
    kind: 'rhiza',
    state: r.status.state === 'degraded' ? 'degraded' : 'unreachable',
    reason: r.status.detail ?? r.status.state,
  }))
  return [...plugins, ...systems]
}

interface LegendEntry { tone: Tone, label: string, value: number }

function HealthCard({ body, systemsDown }: { body: Body | null, systemsDown: number }): React.JSX.Element {
  const t = useT()
  const total = body === null ? 0 : body.plugins.length
  const segments: readonly Segment[] = body === null ? [] : [
    { tone: 'ok', value: body.germinated, label: t('state.germinated') },
    { tone: 'warn', value: body.dormant, label: t('state.dormant') },
    { tone: 'idle', value: body.disabled, label: t('state.disabled') },
  ]
  // 1a-overview-mobile-healthy-light.png prints no `Dormant 0`: a state nothing is in is noise.
  // A rhiza that stopped answering is not a plugin state, so it is a legend entry and no segment.
  const entries: readonly LegendEntry[] = [
    ...segments.map((s): LegendEntry => ({ tone: s.tone, label: s.label, value: s.value })),
    { tone: 'warn', label: t('overview.systemsDown'), value: systemsDown },
  ]
  const legend = entries.filter((entry) => entry.value > 0)

  return (
    <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
      <h2 className="text-meta uppercase tracking-wide text-text/60">{t('overview.health')}</h2>
      <p className="flex flex-wrap items-baseline gap-2">
        <span data-testid="germinated-count" className="text-hero font-medium">
          {body === null ? '—' : String(body.germinated)}
        </span>
        <span className="text-body text-text/70">{t('overview.hero', { total })}</span>
      </p>
      <ProportionBar segments={segments} />
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {legend.map((entry) => (
          <div key={entry.label} data-legend={entry.label} className="min-w-24">
            <span className="flex items-center gap-2 text-meta-lg text-text/70">
              <Dot tone={entry.tone} />
              {entry.label}
            </span>
            <span className={`text-hero font-medium ${TONE_CLASSES[entry.tone].text}`}>
              {String(entry.value)}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

const MAX_HITS = 8

/**
 * 1a's cross-entity field, as a client filter over what this screen already holds (§3 row 19).
 * People are not in that: the term is handed to the screen that can search them, rather than
 * a second debounced query from here.
 */
function Search(
  { plugins, commands }: { plugins: readonly PluginDto[], commands: readonly CommandDto[] },
): React.JSX.Element {
  const t = useT()
  const [term, setTerm] = useState('')
  const needle = term.trim().toLowerCase()
  const pluginHits = needle === ''
    ? []
    : plugins.filter((p) => p.name.toLowerCase().includes(needle))
  const commandHits = needle === ''
    ? []
    : commands.filter((c) => c.qualified.toLowerCase().includes(needle)
      || c.declared.toLowerCase().includes(needle))

  return (
    <div className="w-full md:w-65">
      <input
        type="search"
        value={term}
        aria-label={t('overview.search')}
        placeholder={t('overview.search')}
        onChange={(e) => { setTerm(e.target.value) }}
        className="w-full rounded-md border border-line bg-surface px-3 py-2 text-body"
      />
      {needle !== '' && (
        <div
          data-testid="search-hits"
          className="mt-2 space-y-3 rounded-xl border border-line bg-surface p-3"
        >
          {pluginHits.length === 0 && commandHits.length === 0
            ? <EmptyState title={t('overview.noMatch')} body={t('overview.noMatchLead')} />
            : (
                <>
                  <Group
                    label={t('overview.plugins')}
                    total={pluginHits.length}
                    seeAll="/plugins"
                    rows={pluginHits.slice(0, MAX_HITS).map((p) => ({
                      key: p.name, label: p.name, to: `/plugins/${p.name}`,
                    }))}
                  />
                  <Group
                    label={t('tile.commands')}
                    total={commandHits.length}
                    seeAll="/plugins"
                    rows={commandHits.slice(0, MAX_HITS).map((c) => ({
                      key: c.qualified, label: c.qualified, to: `/plugins/${c.plugin}`,
                    }))}
                  />
                </>
              )}
          <Group
            label={t('tile.people')}
            total={1}
            rows={[{
              key: 'people',
              label: t('overview.searchPeople', { term: term.trim() }),
              to: `/people?q=${encodeURIComponent(term.trim())}`,
            }]}
          />
        </div>
      )}
    </div>
  )
}

function Group(
  { label, rows, total, seeAll }: {
    label: string
    rows: readonly { key: string, label: string, to: string }[]
    total: number
    seeAll?: string
  },
): React.JSX.Element | null {
  const t = useT()
  if (rows.length === 0) return null
  return (
    <div>
      <p className="text-meta uppercase tracking-wide text-text/60">{label}</p>
      <ul>
        {rows.map((row) => (
          <li key={row.key}>
            <Link to={row.to} className="block truncate py-0.5 text-body">{row.label}</Link>
          </li>
        ))}
      </ul>
      {seeAll !== undefined && total > rows.length && (
        <Link to={seeAll} className="text-meta-lg text-accent">{t('overview.seeAll')}</Link>
      )}
    </div>
  )
}
