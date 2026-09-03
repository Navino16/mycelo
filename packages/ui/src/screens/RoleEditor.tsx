import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router'
import { api, ApiError } from '../api/client.ts'
import { readArray } from '../api/read.ts'
import { ORDER } from '../api/types.ts'
import { Breadcrumb } from '../components/Breadcrumb.tsx'
import { TONE_CLASSES } from '../components/tone.ts'
import { coversPlugin, grants, wildcardsIn } from '../patterns.ts'
import { useLocale, useT } from '../i18n.tsx'
import type {
  CommandDto, CommandGroups, PageDto, PersonDto, PluginDto, PluginGroups, RoleDto,
} from '../api/types.ts'

interface GroupProps {
  plugin: string
  description?: string
  commands: readonly CommandDto[]
  patterns: readonly string[]
  filter?: string
  onToggle: (qualified: string, granted: boolean) => void
  onSetPlugin?: (plugin: string, granted: boolean) => void
  readOnly?: boolean
}

function matchesFilter(command: CommandDto, needle: string): boolean {
  if (needle === '') return true
  return command.qualified.toLowerCase().includes(needle)
    || command.description.toLowerCase().includes(needle)
}

export function PluginGroup(
  {
    plugin, description, commands, patterns, filter = '', onToggle, onSetPlugin, readOnly = false,
  }: GroupProps,
): React.JSX.Element {
  const t = useT()
  // Collapsed by default (2g-role-editor-desktop.png), which only the `Filter {n} commands`
  // input makes safe: a group matching the filter opens by itself, so no checkbox is
  // unreachable without scrolling fourteen groups.
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLInputElement | null>(null)
  const coverage = coversPlugin(patterns, plugin)
  const granted = commands.filter((c) => grants(patterns, c.qualified)).length
  const needle = filter.trim().toLowerCase()
  const shown = commands.filter((c) => matchesFilter(c, needle))
  const matched = needle !== '' && shown.length > 0

  // `indeterminate` is a DOM property with no React attribute, so partial coverage can only
  // be painted through the node itself.
  useEffect(() => {
    if (box.current !== null) box.current.indeterminate = coverage === 'some'
  }, [coverage])

  if (patterns.includes('*')) {
    return (
      <section className="rounded-lg border border-line">
        <div className="flex items-baseline justify-between gap-3 p-3">
          <span className="min-w-0">
            <span className="font-mono">{plugin}</span>
            {description !== undefined && (
              <span className="ml-2 text-body text-text/60">{description}</span>
            )}
          </span>
          <span className="text-meta-lg text-text/50">{t('role.covered')}</span>
        </div>
      </section>
    )
  }

  const full = granted === commands.length && commands.length > 0
  return (
    <section className="rounded-lg border border-line">
      <div className="flex items-center gap-3 p-3">
        <input
          ref={box}
          type="checkbox"
          aria-label={t('role.groupToggle', { plugin })}
          checked={coverage === 'all'}
          disabled={readOnly || onSetPlugin === undefined}
          onChange={(e) => { onSetPlugin?.(plugin, e.target.checked) }}
        />
        <button
          type="button"
          aria-expanded={open || matched}
          onClick={() => { setOpen((o) => !o) }}
          className="grid flex-1 items-baseline gap-x-3 gap-y-0.5 text-left md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_8rem_5rem_1rem]"
        >
          <span className="truncate font-mono">{plugin}</span>
          <span className="truncate text-body text-text/60">{description ?? ''}</span>
          <span className="font-mono text-meta-lg text-text/60">
            {coverage === 'all' ? `${plugin}.*` : '—'}
          </span>
          <span className={`font-mono text-meta-lg ${full ? TONE_CLASSES.ok.text : 'text-text/60'}`}>
            {t('role.counter', { granted, total: commands.length })}
          </span>
          <span
            aria-hidden="true"
            className={`text-text/40 md:justify-self-end ${open || matched ? 'rotate-180' : ''}`}
          >
            {'⌄'}
          </span>
        </button>
      </div>

      {(open || matched) && coverage === 'all' && (
        <p className="border-t border-line-soft p-3 text-body text-text/70">{t('role.wildcard')}</p>
      )}

      {(open || matched) && coverage !== 'all' && (
        <ul className="divide-y divide-line-soft border-t border-line-soft">
          {shown.map((c) => (
            <li key={c.qualified} className="flex items-start gap-3 p-3">
              <input
                type="checkbox"
                id={c.qualified}
                data-testid={c.qualified}
                disabled={readOnly}
                checked={grants(patterns, c.qualified)}
                onChange={(e) => { onToggle(c.qualified, e.target.checked) }}
              />
              <label htmlFor={c.qualified} className="min-w-0">
                <span className="font-mono">{c.command}</span>
                {c.command !== c.declared && (
                  <span className="ml-2 text-meta text-text/60">({c.declared})</span>
                )}
                <p className="text-body text-text/70">{c.description}</p>
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function isCommandGroups(value: unknown): value is CommandGroups {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function describedPlugins(groups: PluginGroups): Readonly<Record<string, string>> {
  const map: Record<string, string> = {}
  for (const kind of ORDER) {
    for (const plugin of readArray<PluginDto>(groups[kind]) ?? []) {
      if (plugin.description !== undefined) map[plugin.name] = plugin.description
    }
  }
  return map
}

export function RoleEditor(): React.JSX.Element {
  const t = useT()
  const { locale } = useLocale()
  const { name = '' } = useParams()
  const [commands, setCommands] = useState<CommandGroups | null>(null)
  const [role, setRole] = useState<RoleDto | null>(null)
  const [patterns, setPatterns] = useState<readonly string[]>([])
  const [saved, setSaved] = useState<readonly string[]>([])
  const [holders, setHolders] = useState<number | null>(null)
  const [descriptions, setDescriptions] = useState<Readonly<Record<string, string>>>({})
  const [filter, setFilter] = useState('')
  const [pick, setPick] = useState('')
  const [error, setError] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      api.get<CommandGroups>('/api/commands'),
      api.get<RoleDto>(`/api/roles/${name}`),
    ]).then(([c, r]) => {
      setCommands(c)
      setRole(r)
      const held = readArray<string>(r.patterns) ?? []
      setPatterns(held)
      setSaved(held)
      setError(false)
      // Fired from inside this resolution rather than from an effect keyed on the fetched
      // role: such an effect outlives its own fetch mock and leaks a live request.
      api.get<PageDto<PersonDto>>(`/api/people?role=${encodeURIComponent(name)}&perPage=1`).then(
        (page) => { setHolders(page.total) },
        () => undefined,
      )
    }, () => { setError(true) })
  }, [name, locale])

  useEffect(() => {
    api.get<PluginGroups>('/api/plugins').then(
      (g) => { setDescriptions(describedPlugins(g)) },
      () => undefined,
    )
  }, [])

  function toggle(qualified: string, granted: boolean): void {
    setPatterns((prev) => (granted ? [...prev, qualified] : prev.filter((p) => p !== qualified)))
  }

  function setPlugin(plugin: string, granted: boolean): void {
    setPatterns((prev) => [
      ...prev.filter((p) => !p.startsWith(`${plugin}.`)),
      ...(granted ? [`${plugin}.*`] : []),
    ])
  }

  // Removing a wildcard clears the plugin to nothing rather than guessing which of its
  // commands the operator meant to keep; the operator re-ticks whichever ones they want.
  function removeWildcard(pattern: string): void {
    setPatterns((prev) => prev.filter((p) => p !== pattern))
  }

  function addWildcard(): void {
    if (pick === '') return
    setPlugin(pick, true)
    setPick('')
  }

  async function save(): Promise<void> {
    setSaveError(null)
    try {
      await api.send('PUT', `/api/roles/${name}/commands`, { patterns })
      setSaved(patterns)
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : t('error.generic'))
    }
  }

  const groups = isCommandGroups(commands) ? Object.entries(commands) : []
  const wildcards = wildcardsIn(patterns)
  const holdsAll = patterns.includes('*')

  let total = 0
  let granted = 0
  for (const [, cmds] of groups) {
    const list = readArray<CommandDto>(cmds) ?? []
    total += list.length
    granted += list.filter((c) => grants(patterns, c.qualified)).length
  }

  const crit = TONE_CLASSES.crit
  const ok = TONE_CLASSES.ok
  const warn = TONE_CLASSES.warn

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <Breadcrumb trail={[{ label: t('roles.title'), to: '/roles' }]} />
          <div className="flex flex-wrap items-baseline gap-3">
            <h1 className="font-mono text-page font-semibold">{name}</h1>
            {holders !== null && (
              <span className="text-meta-lg text-text/60">
                {t(holders === 1 ? 'role.holdersOne' : 'role.holders', { count: holders })}
              </span>
            )}
          </div>
        </div>
        {role !== null && commands !== null && (
          <div className="flex flex-wrap items-center gap-2">
            <span className={`font-mono text-title ${ok.text}`}>
              {holdsAll
                ? t(total === 1 ? 'roles.commandsAllOne' : 'roles.commandsAll', { total })
                : t('role.counter', { granted, total })}
            </span>
            {!role.builtin && (
              <>
                <button
                  type="button"
                  onClick={() => { void save() }}
                  className="rounded-md bg-accent px-3 py-2 font-medium text-accent-ink"
                >
                  {t('role.save')}
                </button>
                <button
                  type="button"
                  onClick={() => { setPatterns(saved); setSaveError(null) }}
                  className="rounded-md border border-line px-3 py-2 text-body"
                >
                  {t('role.cancel')}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {error && <p role="alert" className={`text-body ${warn.text}`}>{t('error.generic')}</p>}

      {role !== null && commands !== null && (
        <>
          {role.builtin && <p className="text-body text-text/70">{t('role.builtinReadOnly')}</p>}

          {holdsAll
            ? (
                <section className={`space-y-3 rounded-xl border p-4 ${warn.border} ${warn.bg}`}>
                  <h2 className={`text-title font-semibold ${warn.text}`}>{t('role.holdsAll')}</h2>
                  <p className="max-w-2xl text-body">{t('role.holdsAllLead')}</p>
                  {!role.builtin && (
                    <button
                      type="button"
                      onClick={() => { removeWildcard('*') }}
                      className="rounded-md border border-line bg-surface px-3 py-2 text-body font-medium"
                    >
                      {t('role.removeStar')}
                    </button>
                  )}
                </section>
              )
            : (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <input
                      type="search"
                      value={filter}
                      aria-label={t(total === 1 ? 'role.filterOne' : 'role.filter', { count: total })}
                      placeholder={t(total === 1 ? 'role.filterOne' : 'role.filter', { count: total })}
                      onChange={(e) => { setFilter(e.target.value) }}
                      className="w-full rounded-md border border-line bg-surface px-3 py-2 text-body md:w-70"
                    />
                    <span className="text-meta-lg text-text/60">{t('role.wildcardsHeld')}</span>
                    {wildcards.map((w) => (
                      <span
                        key={w}
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-meta-lg ${ok.bg} ${ok.text}`}
                      >
                        {w}
                        {!role.builtin && (
                          <button
                            type="button"
                            aria-label={t('role.removeWildcard', { pattern: w })}
                            onClick={() => { removeWildcard(w) }}
                          >
                            {'×'}
                          </button>
                        )}
                      </span>
                    ))}
                    {!role.builtin && (
                      <>
                        <select
                          value={pick}
                          aria-label={t('role.wildcardPlugin')}
                          onChange={(e) => { setPick(e.target.value) }}
                          className="rounded-md border border-line bg-surface px-2 py-1 font-mono text-meta-lg"
                        >
                          <option value="">{'—'}</option>
                          {/* The term each choice adds, not the bare plugin name: a plugin
                              already covered has nothing to add and is not offered. */}
                          {groups
                            .filter(([plugin]) => coversPlugin(patterns, plugin) !== 'all')
                            .map(([plugin]) => (
                              <option key={plugin} value={plugin}>{`${plugin}.*`}</option>
                            ))}
                        </select>
                        <button
                          type="button"
                          onClick={addWildcard}
                          className="rounded-full border border-line px-3 py-1 text-meta-lg"
                        >
                          {t('role.addWildcard')}
                        </button>
                      </>
                    )}
                    <span className="text-meta-lg text-text/60 md:ml-auto">
                      {t(groups.length === 1 ? 'role.groupsOne' : 'role.groups', { count: groups.length })}
                    </span>
                  </div>
                  <p className="text-meta-lg text-text/60">{t('role.wildcardLead')}</p>
                </div>
              )}

          <div className="space-y-2">
            {groups.map(([plugin, cmds]) => (
              <PluginGroup
                key={plugin}
                plugin={plugin}
                {...(descriptions[plugin] === undefined ? {} : { description: descriptions[plugin] })}
                commands={readArray<CommandDto>(cmds) ?? []}
                patterns={patterns}
                filter={filter}
                onToggle={toggle}
                {...(role.builtin ? {} : { onSetPlugin: setPlugin })}
                readOnly={role.builtin}
              />
            ))}
          </div>

          {saveError !== null && <p role="alert" className={`text-body ${crit.text}`}>{saveError}</p>}
        </>
      )}
    </div>
  )
}
