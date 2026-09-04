import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api } from '../api/client.ts'
import { readArray } from '../api/read.ts'
import { ORDER } from '../api/types.ts'
import { Chip } from '../components/Chip.tsx'
import { EmptyState } from '../components/EmptyState.tsx'
import { KindSection } from '../components/KindSection.tsx'
import { TONE_CLASSES } from '../components/tone.ts'
import { plural, useT } from '../i18n.tsx'
import { flatPlugins } from '../plugins.ts'
import type { PluginDto, PluginGroups } from '../api/types.ts'

type Filter = 'all' | 'dormant' | 'disabled'

function commandsOf(plugin: PluginDto): readonly string[] {
  return readArray<string>(plugin.commands) ?? []
}

/** design note 1b: the field covers names, what a plugin does, and the commands it adds. */
function matches(plugin: PluginDto, needle: string): boolean {
  if (needle === '') return true
  return plugin.name.toLowerCase().includes(needle)
    || plugin.description?.toLowerCase().includes(needle) === true
    || commandsOf(plugin).some((c) => c.toLowerCase().includes(needle))
}

export function Plugins(): React.JSX.Element {
  const t = useT()
  const [groups, setGroups] = useState<PluginGroups | null>(null)
  const [error, setError] = useState(false)
  const [term, setTerm] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  useEffect(() => {
    api.get<PluginGroups>('/api/plugins').then(
      (g) => { setGroups(g); setError(false) },
      () => { setError(true) },
    )
  }, [])

  const needle = term.trim().toLowerCase()
  const all = flatPlugins(groups)
  const commands = all.reduce((sum, p) => sum + commandsOf(p).length, 0)
  const dormant = all.filter((p) => p.state === 'dormant').length
  const disabled = all.filter((p) => p.state === 'disabled').length

  const keep = (plugin: PluginDto): boolean => (
    (filter === 'all' || plugin.state === filter) && matches(plugin, needle)
  )
  const narrowed = needle !== '' || filter !== 'all'
  const sections = ORDER
    .map((kind) => ({ kind, plugins: (readArray<PluginDto>(groups?.[kind]) ?? []).filter(keep) }))
    // A narrowed list drops the kinds it emptied: "No plugin of this kind." five times over
    // is not an answer to a search, and 1b-plugins-mobile-no-results.png draws one card.
    .filter((section) => !narrowed || section.plugins.length > 0)
  const installed = plural(t, 'plugins.installed', all.length, { count: all.length })
  const declared = plural(t, 'detail.commandCount', commands, { count: commands })
  // One call, two attributes: the aria-label and the placeholder are the same sentence.
  const searchLabel = plural(t, 'plugins.search', all.length, { count: all.length })

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-page font-semibold">{t('plugins.title')}</h1>
          {groups !== null && (
            <p className="font-mono text-meta-lg text-text/60">{`${installed} · ${declared}`}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={term}
            aria-label={searchLabel}
            placeholder={searchLabel}
            onChange={(e) => { setTerm(e.target.value) }}
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-body md:w-65"
          />
          <Link
            to="/sources"
            className="shrink-0 rounded-md bg-accent px-3 py-2 font-medium text-accent-ink"
          >
            {t('plugins.inoculate')}
          </Link>
        </div>
      </div>

      {error && <p role="alert" className={`text-body ${TONE_CLASSES.warn.text}`}>{t('error.generic')}</p>}

      {groups !== null && all.length === 0 && (
        // ruling F16: one empty state, not five `No plugin of this kind` cards, and not three
        // filters that can narrow nothing. The guided start lives on the Overview.
        <EmptyState
          title={t('guided.nothingInstalled')}
          body={t('guided.nothingInstalledLead')}
          action={(
            <Link to="/" className="rounded-md bg-accent px-3 py-2 font-medium text-accent-ink">
              {t('plugins.guidedCta')}
            </Link>
          )}
        />
      )}

      {groups !== null && all.length > 0 && (
        <>
          <div className="flex flex-wrap gap-2">
            <Chip
              label={t('filter.all')}
              count={all.length}
              active={filter === 'all'}
              onClick={() => { setFilter('all') }}
            />
            <Chip
              label={t('filter.dormant')}
              count={dormant}
              tone="warn"
              active={filter === 'dormant'}
              onClick={() => { setFilter('dormant') }}
            />
            <Chip
              label={t('filter.disabled')}
              count={disabled}
              active={filter === 'disabled'}
              onClick={() => { setFilter('disabled') }}
            />
          </div>

          {sections.length === 0
            // A filter empties the list as readily as a search does, and the search sentence
            // would then quote a term nobody typed. `all` never reaches here: an unnarrowed
            // list keeps all five sections.
            ? (needle === '' && filter !== 'all'
                ? (
                    <EmptyState
                      title={t('plugins.noneInState', { state: t(`state.${filter}`).toLowerCase() })}
                      body={t('plugins.noneInStateLead')}
                    />
                  )
                : (
                    <EmptyState
                      title={t('plugins.noMatch', { term: term.trim() })}
                      body={t('plugins.noMatchLead')}
                      action={(
                        <Link to="/sources" className="rounded-md border border-line px-3 py-2 text-body">
                          {t('plugins.searchSources')}
                        </Link>
                      )}
                    />
                  ))
            : sections.map((section) => (
              <KindSection key={section.kind} kind={section.kind} plugins={section.plugins} />
            ))}
        </>
      )}
    </div>
  )
}
