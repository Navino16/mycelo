import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { SporeKind } from '@mycelo/septum'
import type { RuntimeState } from '../../boot/state.js'
import { enablePlugin } from '../../config/lifecycle.js'
import { formSchemaOf, listPlugins, redactSecrets, rejectedSettings, rewriteSetting, undeclaredKeys } from '../../config/plugins.js'
import { getInstall, listInstalls, setEnabled } from '../../config/store.js'
import { badRequest, notFound } from '../errors.js'
import { parseBody } from '../parse.js'

export interface PluginDto {
  name: string
  /** Absent only for a `registry.dormant` entry whose manifest never parsed (spec §8). */
  kind?: SporeKind
  commands: readonly string[]
  state: 'germinated' | 'dormant' | 'disabled' | 'unknown'
  reason?: string
  /** From the install row, which can disagree with `state` until the next germination. */
  enabled: boolean
  scopes: readonly string[]
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
      scopes: [],
    }))
  }
  const { registry } = state.germination.mycelium
  const scopesOf = new Map<string, readonly string[]>([
    ...registry.enzymes.map((e) => [e.name, e.scopes] as const),
    ...registry.inhibitors.map((i) => [i.name, i.scopes] as const),
  ])
  return listPlugins(registry, state.config.sporesDirs, state.db).map((info) => ({
    name: info.name,
    ...(info.kind === undefined ? {} : { kind: info.kind }),
    commands: info.commands,
    state: info.state,
    ...(info.reason === undefined ? {} : { reason: info.reason }),
    enabled: installs.get(info.name)?.enabled ?? info.enabled,
    scopes: scopesOf.get(info.name) ?? [],
  }))
}

export function registerPluginRoutes(app: FastifyInstance, state: RuntimeState): void {
  app.get('/api/plugins', () => groupByKind(pluginsOf(state)))

  app.get('/api/plugins/:name', (request) => {
    const { name } = request.params as { name: string }
    const found = pluginsOf(state).find((p) => p.name === name)
    if (found === undefined) throw notFound('api.pluginNotFound', { plugin: name })
    return found
  })

  app.post('/api/plugins/:name/enable', async (request) => {
    const { name } = request.params as { name: string }
    requireInstalled(state, name)
    // enablePlugin(), not enableOrThrow(): its EnableRefusal is a discriminated result,
    // never a throw, so an exception reaching here is a genuine fault and must not be
    // relabelled a client mistake (task 10's review, Important 3, applied here too).
    const result = await enablePlugin(state.db, state.config.sporesDirs, name)
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

  app.get('/api/plugins/:name/schema', async (request) => {
    const { name } = request.params as { name: string }
    requireInstalled(state, name)
    return await formSchemaOf(state.db, state.config.sporesDirs, name)
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
    const form = await formSchemaOf(state.db, state.config.sporesDirs, name)
    const bad = undeclaredKeys(form, keys)
    if (bad.length > 0) {
      // detail carries the structure (§9): a form wanting to highlight fields would
      // otherwise have to parse the localized sentence back apart.
      throw badRequest('api.pluginSettingUndeclared', { plugin: name, keys: bad.join(', ') }, bad)
    }
    // Declared is not valid: without this an enabled plugin takes a value that makes it
    // dormant at the next boot, which is the failure enablePlugin() exists to prevent (§8).
    const rejected = await rejectedSettings(state.db, state.config.sporesDirs, name, body)
    if (rejected.length > 0) {
      const rejectedKeys = rejected.map((r) => r.key).join(', ')
      throw badRequest('api.pluginSettingInvalid', { plugin: name, keys: rejectedKeys }, rejected)
    }
    // Every key declared and every value parsed, so only the database can still fail: one
    // synchronous transaction makes that all-or-nothing. rewriteSetting is synchronous, so
    // it can run inside bun:sqlite's transaction(), which cannot await.
    state.db.transaction(() => {
      for (const [key, value] of Object.entries(body)) rewriteSetting(state.db, name, key, value)
    })
    return { ok: true, restartRequired: state.germination.status === 'germinated' }
  })
}

function requireInstalled(state: RuntimeState, name: string): void {
  if (getInstall(state.db, name) === null) throw notFound('api.pluginNotFound', { plugin: name })
}
