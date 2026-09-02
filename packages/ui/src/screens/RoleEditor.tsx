import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { api, ApiError } from '../api/client.ts'
import { readArray } from '../api/read.ts'
import { coversPlugin, grants, wildcardsIn } from '../patterns.ts'
import { useT } from '../i18n.tsx'
import type { CommandDto, CommandGroups, RoleDto } from '../api/types.ts'

interface GroupProps {
  plugin: string
  commands: readonly CommandDto[]
  patterns: readonly string[]
  onToggle: (qualified: string, granted: boolean) => void
  onSelectAll?: (plugin: string) => void
  readOnly?: boolean
}

export function PluginGroup(
  { plugin, commands, patterns, onToggle, onSelectAll, readOnly = false }: GroupProps,
): React.JSX.Element {
  const t = useT()
  // Open by default: a group holds up to ~40 commands, not thousands, and starting closed
  // would hide the very checkboxes an operator lands on this screen to tick.
  const [open, setOpen] = useState(true)
  const coverage = coversPlugin(patterns, plugin)
  const granted = commands.filter((c) => grants(patterns, c.qualified)).length

  return (
    <section className="rounded-lg border border-line">
      <button
        type="button"
        onClick={() => { setOpen((o) => !o) }}
        className="flex w-full items-center justify-between p-3"
      >
        <span className="font-mono">{plugin}</span>
        <span className="text-sm text-text/70">
          {coverage === 'all'
            ? patterns.includes('*') ? '*' : `${plugin}.*`
            : t('role.counter', { granted, total: commands.length })}
        </span>
      </button>

      {coverage === 'all' && (
        <p className="border-t border-line-soft p-3 text-sm text-text/70">{t('role.wildcard')}</p>
      )}

      {open && coverage !== 'all' && (
        <div className="border-t border-line-soft">
          {!readOnly && onSelectAll !== undefined && (
            <button
              type="button"
              onClick={() => { onSelectAll(plugin) }}
              className="w-full border-b border-line-soft p-2 text-left text-sm text-accent"
            >
              {t('role.selectAll')}
            </button>
          )}
          <ul className="divide-y divide-line-soft">
            {commands.map((c) => (
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
                    <span className="ml-2 text-xs text-text/60">({c.declared})</span>
                  )}
                  <p className="text-sm text-text/70">{c.description}</p>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function isCommandGroups(value: unknown): value is CommandGroups {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function RoleEditor(): React.JSX.Element {
  const t = useT()
  const { name = '' } = useParams()
  const [commands, setCommands] = useState<CommandGroups | null>(null)
  const [role, setRole] = useState<RoleDto | null>(null)
  const [patterns, setPatterns] = useState<readonly string[]>([])
  const [error, setError] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      api.get<CommandGroups>('/api/commands'),
      api.get<RoleDto>(`/api/roles/${name}`),
    ]).then(([c, r]) => {
      setCommands(c)
      setRole(r)
      setPatterns(readArray<string>(r.patterns) ?? [])
      setError(false)
    }, () => { setError(true) })
  }, [name])

  function toggle(qualified: string, granted: boolean): void {
    setPatterns((prev) => (granted ? [...prev, qualified] : prev.filter((p) => p !== qualified)))
  }

  function selectAll(plugin: string): void {
    setPatterns((prev) => [...prev.filter((p) => !p.startsWith(`${plugin}.`)), `${plugin}.*`])
  }

  // Removing a wildcard clears the plugin to nothing rather than guessing which of its
  // commands the operator meant to keep; the operator re-ticks whichever ones they want.
  function removeWildcard(pattern: string): void {
    setPatterns((prev) => prev.filter((p) => p !== pattern))
  }

  async function save(): Promise<void> {
    setSaveError(null)
    try {
      await api.send('PUT', `/api/roles/${name}/commands`, { patterns })
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : t('error.generic'))
    }
  }

  const groups = isCommandGroups(commands) ? Object.entries(commands) : []
  const wildcards = wildcardsIn(patterns)

  let total = 0
  let granted = 0
  for (const [, cmds] of groups) {
    const list = readArray<CommandDto>(cmds) ?? []
    total += list.length
    granted += list.filter((c) => grants(patterns, c.qualified)).length
  }

  return (
    <div className="space-y-6">
      <h1 className="font-mono text-xl">{name}</h1>
      {error && <p role="alert" className="text-sm text-crit">{t('error.generic')}</p>}

      {role !== null && commands !== null && (
        <>
          <p className="text-sm text-text/70">{t('role.counter', { granted, total })}</p>
          {role.builtin && <p className="text-sm text-text/70">{t('role.builtinReadOnly')}</p>}

          {wildcards.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-sm font-medium">{t('role.wildcardsHeld')}</h2>
              <ul className="flex flex-wrap gap-2">
                {wildcards.map((w) => (
                  <li key={w} className="flex items-center gap-2 rounded-full bg-ok-bg px-3 py-1 font-mono text-xs text-ok">
                    {w}
                    {!role.builtin && (
                      <button
                        type="button"
                        aria-label={t('role.removeWildcard', { pattern: w })}
                        onClick={() => { removeWildcard(w) }}
                      >
                        ×
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-3">
            {groups.map(([plugin, cmds]) => (
              <PluginGroup
                key={plugin}
                plugin={plugin}
                commands={readArray<CommandDto>(cmds) ?? []}
                patterns={patterns}
                onToggle={toggle}
                onSelectAll={role.builtin ? undefined : selectAll}
                readOnly={role.builtin}
              />
            ))}
          </div>

          {!role.builtin && (
            <button
              type="button"
              onClick={() => { void save() }}
              className="rounded-md bg-accent px-3 py-2 text-accent-ink"
            >
              {t('role.save')}
            </button>
          )}
          {saveError !== null && <p role="alert" className="text-sm text-crit">{saveError}</p>}
        </>
      )}
    </div>
  )
}
