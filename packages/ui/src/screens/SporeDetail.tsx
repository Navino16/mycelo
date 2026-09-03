import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { api, ApiError } from '../api/client.ts'
import { readArray } from '../api/read.ts'
import { Breadcrumb } from '../components/Breadcrumb.tsx'
import { Chip } from '../components/Chip.tsx'
import { EmptyState } from '../components/EmptyState.tsx'
import { ScopeTable } from '../components/ScopeTable.tsx'
import { Sheet } from '../components/Sheet.tsx'
import { TONE_CLASSES } from '../components/tone.ts'
import { plural, useT } from '../i18n.tsx'
import { pluginsByName } from '../plugins.ts'
import { allCommands } from '../rights.ts'
import { SCOPE_SENTENCE, highRiskScopes } from '../scopes.ts'
import type {
  CommandCapabilityDto, CommandGroups, InoculateOutcome, PluginDto, PluginGroups,
  RequirementDto, SourceDto, SporeStrainsDto,
} from '../api/types.ts'
import type { Tone } from '../components/tone.ts'
import type { StringKey } from '../../locales/en.ts'

export function TrustNotice({ official }: { official: boolean }): React.JSX.Element | null {
  const t = useT()
  if (official) return null
  const { border, bg } = TONE_CLASSES.warn
  return (
    <p role="note" className={`rounded-lg border p-3 text-body ${border} ${bg}`}>
      {t('spore.trust')}
    </p>
  )
}

/** A target may carry its own range — `radarr@^2` — and is matched on the name alone. */
function targetName(target: string): string {
  return target.split('@')[0] ?? target
}

/**
 * `mycelium` is the core itself (anastomoses.ts puts it in `resolved`), so it is satisfied by
 * construction and appears in no /api/plugins answer.
 */
function isCore(target: string): boolean { return targetName(target) === 'mycelium' }

function ConsentAlert({ scopes }: { scopes: readonly string[] }): React.JSX.Element {
  const t = useT()
  const { border, bg, text } = TONE_CLASSES.warn
  return (
    // Deliberately no role="alert": it is static disclosure, not a live region, and a second
    // alert on this screen would collide with the install refusal's own.
    <section data-testid="consent" className={`space-y-2 rounded-xl border p-4 ${border} ${bg}`}>
      <h2 className={`text-title font-semibold ${text}`}>{t('spore.consentTitle')}</h2>
      <ul className="space-y-1 text-body">
        {scopes.map((scope) => {
          const sentence = SCOPE_SENTENCE[scope]
          return (
            <li key={scope}>
              <code className="font-mono">{scope}</code>
              {sentence !== undefined && <span className="text-text/80">{` — ${t(sentence)}`}</span>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function Requirements(
  { requires, installed }: { requires: readonly RequirementDto[], installed: ReadonlyMap<string, PluginDto> | null },
): React.JSX.Element {
  const t = useT()
  return (
    <ul data-testid="requirements" className="space-y-2 text-body">
      {requires.map((requirement) => {
        const targets = readArray<string>(requirement.targets) ?? []
        const met = targets.filter((target) => isCore(target) || installed?.has(targetName(target)) === true)
        const one = targets[0]
        const answer = ((): { text: string, tone: Tone } => {
          if (installed === null) return { text: '', tone: 'idle' }
          if (met.length === 0) {
            return { text: t('spore.unsatisfied'), tone: requirement.optional ? 'idle' : 'warn' }
          }
          if (requirement.anyOf) return { text: t('spore.anyInstalled', { count: met.length }), tone: 'ok' }
          const strain = one === undefined ? undefined : installed.get(targetName(one))?.strain
          return { text: strain ?? t('spore.satisfied'), tone: 'ok' }
        })()
        return (
          <li
            key={targets.join('|')}
            data-requirement={targets.join('|')}
            className="flex flex-wrap items-baseline justify-between gap-x-3"
          >
            <span className="font-mono">
              {requirement.anyOf && <span className="mr-1 font-sans text-text/60">{t('demands.anyOf')}</span>}
              {targets.join(' · ')}
              {requirement.optional && (
                <span className="ml-2 font-sans text-text/60">{`(${t('demands.optional')})`}</span>
              )}
            </span>
            <span className={TONE_CLASSES[answer.tone].text}>{answer.text}</span>
          </li>
        )
      })}
    </ul>
  )
}

function CommandsAdded(
  { name, declared, groups }: {
    name: string, declared: readonly CommandCapabilityDto[], groups: CommandGroups | null,
  },
): React.JSX.Element {
  const t = useT()
  // finding F18: an installed spore's consent page warned that it collided with its own
  // routes. Same plugin name, same commands — a reinstall replaces them rather than clashing.
  const existing = allCommands(groups).filter((c) => c.plugin !== name)
  // `command`, not `declared`: germination keys its route table by the alias-resolved name
  // (registry.ts:101), and a check the runtime disagrees with is broken either way.
  const clashes = declared.filter((c) => existing.some((e) => e.command === c.name)).map((c) => c.name)
  return (
    <section className="space-y-2 rounded-xl border border-line bg-surface p-4">
      <h2 className="text-title font-semibold">{t('spore.commandsAdded')}</h2>
      <ul className="space-y-1 font-mono text-body">
        {declared.map((c) => <li key={c.name}>{c.name}</li>)}
      </ul>
      {groups !== null && (
        clashes.length === 0
          ? (
            <p className="text-meta-lg text-text/60">
              {plural(t, 'spore.noCollision', existing.length, { count: existing.length })}
            </p>
          )
          : (
            <p className={`text-meta-lg ${TONE_CLASSES.warn.text}`}>
              {t('spore.collision', { names: clashes.join(', ') })}
            </p>
          )
      )}
    </section>
  )
}

export function SporeDetail(): React.JSX.Element {
  const t = useT()
  const { id = '', name = '' } = useParams()
  const [strains, setStrains] = useState<SporeStrainsDto | null>(null)
  const [source, setSource] = useState<SourceDto | null>(null)
  const [groups, setGroups] = useState<PluginGroups | null>(null)
  const [commands, setCommands] = useState<CommandGroups | null>(null)
  const [outcome, setOutcome] = useState<InoculateOutcome | null>(null)
  // Two independent fetches: a shared boolean set by both would race if one resolves after
  // the other, so each keeps its own flag and the alert is their union. The two joins below
  // are decoration and get no flag: refusing them costs their column, not the screen.
  const [sporeError, setSporeError] = useState(false)
  const [sourceError, setSourceError] = useState(false)
  // A 404 is the source answering that it holds nothing under this name — a `local` driver
  // says so in a sentence the operator needs, and error.generic threw it away.
  const [refusal, setRefusal] = useState<string | null>(null)
  const [installError, setInstallError] = useState<string | null>(null)
  const [strainSheet, setStrainSheet] = useState(false)
  const error = sporeError || sourceError

  // The two joins the install itself invalidates: the state chip and the collision line both
  // read them, and both stayed on the pre-install answer until a reload.
  const readJoins = useCallback((): void => {
    api.get<PluginGroups>('/api/plugins').then((v) => { setGroups(v) }, () => { setGroups(null) })
    api.get<CommandGroups>('/api/commands').then((v) => { setCommands(v) }, () => { setCommands(null) })
  }, [])

  useEffect(() => {
    api.get<SporeStrainsDto>(`/api/sources/${id}/spores/${name}`).then(
      (v) => { setStrains(v); setSporeError(false); setRefusal(null) },
      (e: unknown) => {
        setSporeError(true)
        setRefusal(e instanceof ApiError && e.status === 404 ? e.message : null)
      },
    )
    api.get<SourceDto>(`/api/sources/${id}`).then(
      (v) => { setSource(v); setSourceError(false) },
      () => { setSourceError(true) },
    )
    readJoins()
  }, [id, name, readJoins])

  const spore = strains?.detail ?? null
  const offered = readArray<string>(strains?.strains) ?? []
  const newest = offered[0]
  const warnings = readArray<string>(outcome?.warnings) ?? []
  const installed = pluginsByName(groups)

  async function install(strain?: string): Promise<void> {
    try {
      const result = await api.send<InoculateOutcome>(
        'POST', `/api/sources/${id}/inoculate`, strain === undefined ? { name } : { name, strain },
      )
      setStrainSheet(false)
      setOutcome(result)
      setInstallError(null)
      readJoins()
    } catch (e) {
      setStrainSheet(false)
      setInstallError(e instanceof Error ? e.message : t('error.generic'))
    }
  }

  if (error) {
    return (
      <p role="alert" className={`text-body ${TONE_CLASSES.warn.text}`}>
        {refusal ?? t('error.generic')}
      </p>
    )
  }
  if (spore === null || source === null) return <div />

  const scopes = readArray<string>(spore.demands.scopes) ?? []
  const requires = readArray<RequirementDto>(spore.demands.requires) ?? []
  const declaredCommands = readArray<CommandCapabilityDto>(spore.demands.commands) ?? []
  const highRisk = highRiskScopes(scopes)
  // `undefined` is "known and not installed"; `null` is "the join said nothing", and the
  // chip is dropped rather than claiming either (review finding 1).
  const here = installed === null ? null : installed.get(spore.name)

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <header className="space-y-2">
          <Breadcrumb
            trail={[
              { label: t('sources.title'), to: '/sources' },
              { label: source.label, to: `/sources/${id}` },
              { label: t(`kind.${spore.kind}` as StringKey) },
            ]}
          />
          <h1 className="font-mono text-page">{spore.name}</h1>
          <p className="text-body text-text/70">{spore.description}</p>
          <div className="flex flex-wrap items-center gap-2">
            {here !== null && (
              <span data-testid="install-state">
                <Chip
                  label={t(here === undefined ? 'spore.notInstalled' : 'spore.installed')}
                  tone={here === undefined ? 'idle' : 'ok'}
                />
              </span>
            )}
            {newest !== undefined && <Chip label={t('spore.strain', { strain: newest })} />}
            <Chip
              label={plural(t, 'detail.commandCount', declaredCommands.length, {
                count: declaredCommands.length,
              })}
            />
          </div>
          <p className="text-meta-lg text-text/60">{t('spore.septum', { range: spore.septum })}</p>
        </header>

        <div className="w-full space-y-2 md:w-80">
          {/* The plugin trust model made visible (CLAUDE.md, user 2026-08-13): it qualifies
              the button, so it sits above it and in no artboard. */}
          <TrustNotice official={source.official} />
          {outcome === null
            ? (
              <>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => { void install() }}
                    className="rounded-md bg-accent px-3 py-2 font-medium text-accent-ink"
                  >
                    {scopes.length === 0
                      ? t('spore.install')
                      : plural(t, 'spore.inoculateGrant', scopes.length, { count: scopes.length })}
                  </button>
                  {offered.length > 1 && (
                    <button
                      type="button"
                      onClick={() => { setStrainSheet(true) }}
                      className="rounded-md border border-line px-3 py-2 text-body"
                    >
                      {t('spore.otherStrains')}
                    </button>
                  )}
                </div>
                <p className="text-meta-lg text-text/60">{t('spore.installOnly')}</p>
              </>
            )
            : (
              <div className={`space-y-2 rounded-lg border p-3 ${TONE_CLASSES.ok.border} ${TONE_CLASSES.ok.bg}`}>
                <p>{t('spore.installedAs', { strain: outcome.strain })}</p>
                {warnings.map((w) => <p key={w} className="text-body text-text/80">{w}</p>)}
              </div>
            )}
          {installError !== null && (
            <p role="alert" className={`text-body ${TONE_CLASSES.warn.text}`}>{installError}</p>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        <div className="space-y-4">
          {highRisk.length > 0 && <ConsentAlert scopes={highRisk} />}
          {/* ruling I5: a heading over an empty <ul> is the headed empty container I5 removed
              from six other screens. Reachable on the official registry's own `links`. */}
          {scopes.length === 0
            ? <EmptyState title={t('spore.noScopesTitle')} body={t('spore.noScopes')} />
            : (
                <section className="rounded-xl border border-line bg-surface">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line p-4">
                    <h2 className="text-title font-semibold">{t('spore.scopes', { count: scopes.length })}</h2>
                    <span className="text-meta-lg text-text/60">{t('spore.grantedAtInstall')}</span>
                  </div>
                  <ScopeTable scopes={scopes} />
                </section>
              )}
        </div>
        <div className="space-y-4">
          {requires.length === 0
            ? <EmptyState title={t('spore.noRequirementsTitle')} body={t('spore.noRequirements')} />
            : (
                <section className="space-y-2 rounded-xl border border-line bg-surface p-4">
                  <h2 className="text-title font-semibold">{t('spore.requirements')}</h2>
                  <Requirements requires={requires} installed={installed} />
                </section>
              )}
          {declaredCommands.length > 0 && (
            <CommandsAdded name={spore.name} declared={declaredCommands} groups={commands} />
          )}
        </div>
      </div>

      <Sheet title={t('spore.otherStrains')} open={strainSheet} onClose={() => { setStrainSheet(false) }}>
        <ul className="space-y-2">
          {offered.filter((strain) => strain !== newest).map((strain) => (
            <li key={strain}>
              <button
                type="button"
                onClick={() => { void install(strain) }}
                className="w-full rounded-md border border-line px-3 py-2 text-left font-mono text-body"
              >
                {strain}
              </button>
            </li>
          ))}
        </ul>
      </Sheet>
    </div>
  )
}
