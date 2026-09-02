import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { MyceliumScope, SporeKind } from '@mycelo/septum'
import type { RuntimeState } from '../../boot/state.js'
import { enablePlugin } from '../../config/lifecycle.js'
import {
  formSchemaOf, listPlugins, provenanceByName, redactSecrets, rejectedSettings, rewriteSetting, secretKeysOf,
  undeclaredKeys,
} from '../../config/plugins.js'
import { getInstall, listInstalls, setEnabled } from '../../config/store.js'
import { findSpore } from '../../config/lifecycle.js'
import { demandsOf } from '../../germination/requirements.js'
import type { SporeDemands } from '../../germination/requirements.js'
import { isFailure } from '../../germination/manifest.js'
import { badRequest, notFound } from '../errors.js'
import { parseBody } from '../parse.js'
import { AliasRefused, clearAlias, setAlias } from '../../rhizomorph/aliases.js'
import { describeThrown } from '../../support/thrown.js'

export interface PluginDto {
  name: string
  /** Absent only for a `registry.dormant` entry whose manifest never parsed (spec §8). */
  kind?: SporeKind
  commands: readonly string[]
  state: 'germinated' | 'dormant' | 'disabled' | 'pending' | 'unknown'
  reason?: string
  /** From the install row, which can disagree with `state` until the next germination. */
  enabled: boolean
  /**
   * The sporangium's label and the installed strain. Both absent for a spore from a local
   * root, which is neither versioned nor traceable (design §7.4).
   */
  source?: string
  strain?: string
}

/**
 * `GET /api/plugins/:name`. `demands` is what the spore asks for, read from its manifest on
 * disk so a disabled or dormant plugin answers it too (spec §4.2); `mounted` is what
 * germination actually granted. Both absent means the manifest does not parse, exactly as
 * `kind` is absent for that reason — a spore declaring nothing answers empty lists instead.
 */
export interface PluginDetailDto extends PluginDto {
  demands?: SporeDemands
  /** Absent unless this spore is germinated. Empty for a kind that mounts nothing (spec §4.3). */
  mounted?: readonly MyceliumScope[]
}

/**
 * The wire shape of `GET /api/plugins` (spec §8, §15): all four kinds plus `unknown`,
 * every key present even when empty, so the UI has no absence case to branch on.
 */
export type PluginGroups = { [K in SporeKind | 'unknown']: readonly PluginDto[] }

// A plain groupBy(kind) would drop every entry whose kind is absent — precisely the
// dormant-before-parse case an operator opens this screen to find (spec §8).
function groupByKind(plugins: readonly PluginDto[]): PluginGroups {
  const groups: { [K in SporeKind | 'unknown']: PluginDto[] } = {
    hypha: [], rhiza: [], enzyme: [], inhibitor: [], unknown: [],
  }
  for (const plugin of plugins) groups[plugin.kind ?? 'unknown'].push(plugin)
  return groups
}

function pluginsOf(state: RuntimeState): readonly PluginDto[] {
  const installs = new Map(listInstalls(state.db).map((i) => [i.name, i]))
  const provenance = provenanceByName(state.db)
  if (state.germination.status !== 'germinated') {
    // Nothing germinated, so nothing is known about any individual plugin (spec §4.1).
    return [...installs.values()].map((install) => ({
      name: install.name,
      // install.kind is stored as plain text; config/plugins.ts's listPlugins() casts the
      // same field the same way — every install row was recorded from a parsed manifest.
      kind: install.kind as SporeKind,
      commands: [],
      state: 'unknown' as const,
      enabled: install.enabled,
      ...(provenance.get(install.name) ?? {}),
    }))
  }
  const { registry } = state.germination.mycelium
  return listPlugins(registry, state.config.discoveryDirs, state.db).map((info) => ({
    name: info.name,
    ...(info.kind === undefined ? {} : { kind: info.kind }),
    commands: info.commands,
    state: info.state,
    ...(info.reason === undefined ? {} : { reason: info.reason }),
    enabled: installs.get(info.name)?.enabled ?? info.enabled,
    ...(info.source === undefined ? {} : { source: info.source }),
    ...(info.strain === undefined ? {} : { strain: info.strain }),
  }))
}

/**
 * What germination granted this spore. Read on the detail route only: the list would need one
 * manifest read per plugin for a screen that shows no dependencies (spec §4.2).
 */
function mountedScopesOf(state: RuntimeState, name: string): readonly MyceliumScope[] | undefined {
  if (state.germination.status !== 'germinated') return undefined
  const { registry } = state.germination.mycelium
  const scoped = registry.enzymes.find((e) => e.name === name)
    ?? registry.inhibitors.find((i) => i.name === name)
  if (scoped !== undefined) return scoped.scopes
  // A germinated hypha or rhiza mounts nothing, which is [] and not absence.
  return [...registry.hyphae, ...registry.rhizas].some((s) => s.name === name) ? [] : undefined
}

const aliasSchema = z.object({ alias: z.string().min(1) })

export function registerPluginRoutes(app: FastifyInstance, state: RuntimeState): void {
  app.get('/api/plugins', () => groupByKind(pluginsOf(state)))

  app.get('/api/plugins/:name', (request): PluginDetailDto => {
    const { name } = request.params as { name: string }
    const found = pluginsOf(state).find((p) => p.name === name)
    if (found === undefined) throw notFound('api.pluginNotFound', { plugin: name })
    const read = findSpore(state.config.discoveryDirs, name)
    const mounted = mountedScopesOf(state, name)
    return {
      ...found,
      ...(read === undefined || isFailure(read) ? {} : { demands: demandsOf(read.manifest) }),
      ...(mounted === undefined ? {} : { mounted }),
    }
  })

  app.post('/api/plugins/:name/enable', async (request) => {
    const { name } = request.params as { name: string }
    requireInstalled(state, name)
    // enablePlugin(), not enableOrThrow(): its EnableRefusal is a discriminated result,
    // never a throw, so an exception reaching here is a genuine fault and must not be
    // relabelled a client mistake (task 10's review, Important 3, applied here too).
    const result = await enablePlugin(state.db, state.config.discoveryDirs, name)
    if (!result.ok) throw badRequest('api.pluginEnableRefused', { plugin: name }, result.reason)
    return { ok: true, restartRequired: state.germination.status === 'germinated' }
  })

  app.post('/api/plugins/:name/disable', (request) => {
    const { name } = request.params as { name: string }
    requireInstalled(state, name)
    setEnabled(state.db, name, false)
    // spec §4.3: retry only exists in degraded mode, so say so rather than let the
    // operator believe a live substrate has already applied it.
    return { ok: true, restartRequired: state.germination.status === 'germinated' }
  })

  // Answers in degraded mode, like disable: the only moment an alias is needed is a moment
  // when nothing germinated, so a channel command could never reach it (spec §3.4).
  app.put('/api/plugins/:name/commands/:command/alias', (request) => {
    const { name, command } = request.params as { name: string, command: string }
    requireDeclaredCommand(state, name, command)
    const { alias } = parseBody(aliasSchema, request.body)
    try {
      setAlias(state.db, name, command, alias)
    } catch (e) {
      // instanceof on the core's own class: a SQL fault is a 500, not the operator's mistake.
      if (!(e instanceof AliasRefused)) throw e
      throw badRequest('api.aliasRefused', { plugin: name, command }, describeThrown(e))
    }
    return { ok: true, restartRequired: state.germination.status === 'germinated' }
  })

  // requireInstalled, not requireDeclaredCommand: an alias holds its word in a globally unique
  // column, so a manifest that stopped parsing must not make it unremovable.
  app.delete('/api/plugins/:name/commands/:command/alias', (request) => {
    const { name, command } = request.params as { name: string, command: string }
    requireInstalled(state, name)
    // `cleared` distinguishes a removal from a no-op: an operator deleting an alias that was
    // never set must not be told one was removed.
    return {
      ok: true,
      cleared: clearAlias(state.db, name, command),
      restartRequired: state.germination.status === 'germinated',
    }
  })

  app.get('/api/plugins/:name/schema', async (request) => {
    const { name } = request.params as { name: string }
    requireInstalled(state, name)
    const form = await formSchemaOf(state.db, state.config.discoveryDirs, name)
    if (!form.available) return form
    // A never-yet-filled credential is in neither the schema nor the redacted settings,
    // so without this the form renders it as an ordinary text input.
    return { ...form, secrets: await secretKeysOf(state.db, state.config.discoveryDirs, name) }
  })

  app.get('/api/plugins/:name/settings', (request) => {
    const { name } = request.params as { name: string }
    requireInstalled(state, name)
    return redactSecrets(state.db, name)
  })

  app.put('/api/plugins/:name/settings', async (request) => {
    const { name } = request.params as { name: string }
    requireInstalled(state, name)
    const body = parseBody(z.record(z.string(), z.unknown()), request.body)
    const keys = Object.keys(body)
    const form = await formSchemaOf(state.db, state.config.discoveryDirs, name)
    const bad = undeclaredKeys(form, keys)
    if (bad.length > 0) {
      // detail carries the structure (§9): a form wanting to highlight fields would
      // otherwise have to parse the localized sentence back apart.
      throw badRequest('api.pluginSettingUndeclared', { plugin: name, keys: bad.join(', ') }, bad)
    }
    // Declared is not valid: without this an enabled plugin takes a value that makes it
    // dormant at the next boot, which is the failure enablePlugin() exists to prevent (§8).
    const rejected = await rejectedSettings(state.db, state.config.discoveryDirs, name, body)
    if (rejected.length > 0) {
      const rejectedKeys = rejected.map((r) => r.key).join(', ')
      throw badRequest('api.pluginSettingInvalid', { plugin: name, keys: rejectedKeys }, rejected)
    }
    // Every key declared and every value parsed, so only the database can still fail: one
    // synchronous transaction makes that all-or-nothing. rewriteSetting is synchronous, so
    // it can run inside bun:sqlite's transaction(), which cannot await — hence resolving
    // the plugin's declared secrets before opening it.
    const secrets = await secretKeysOf(state.db, state.config.discoveryDirs, name)
    state.db.transaction(() => {
      for (const [key, value] of Object.entries(body)) rewriteSetting(state.db, name, key, value, secrets)
    })
    return { ok: true, restartRequired: state.germination.status === 'germinated' }
  })
}

function requireInstalled(state: RuntimeState, name: string): void {
  if (getInstall(state.db, name) === null) throw notFound('api.pluginNotFound', { plugin: name })
}

/**
 * No table holds a command, so only the manifest on disk can say whether one exists. Read here
 * rather than from the registry because an alias is needed exactly when nothing germinated
 * (spec §3.4): a collision leaves no bus, no channel and no command.
 */
function requireDeclaredCommand(state: RuntimeState, name: string, command: string): void {
  requireInstalled(state, name)
  const read = findSpore(state.config.discoveryDirs, name)
  if (read === undefined || isFailure(read)) {
    throw badRequest('api.aliasManifestUnreadable', { plugin: name })
  }
  const declared = read.manifest.kind === 'enzyme'
    && read.manifest.commands.some((spec) => spec.name === command)
  if (!declared) throw notFound('api.commandNotFound', { plugin: name, command })
}
