import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { FormSchema } from '@mycelo/septum'
import type { RuntimeState } from '../../boot/state.js'
import { enablePlugin } from '../../config/lifecycle.js'
import { formSchemaOf, listPlugins, redactSecrets, rewriteSetting } from '../../config/plugins.js'
import { getInstall, listInstalls, setEnabled } from '../../config/store.js'
import { badRequest, notFound } from '../errors.js'
import { parseBody } from '../parse.js'

export interface PluginDto {
  name: string
  kind?: string
  commands: readonly string[]
  state: 'germinated' | 'dormant' | 'disabled' | 'unknown'
  reason?: string
  /** From the install row, which can disagree with `state` until the next germination. */
  enabled: boolean
  scopes: readonly string[]
}

function pluginsOf(state: RuntimeState): readonly PluginDto[] {
  const installs = new Map(listInstalls(state.db).map((i) => [i.name, i]))
  if (state.germination.status !== 'germinated') {
    // Nothing germinated, so nothing is known about any individual plugin (spec §4.1).
    return [...installs.values()].map((install) => ({
      name: install.name,
      kind: install.kind,
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
  return listPlugins(registry, state.config.sporesDir, state.db).map((info) => ({
    name: info.name,
    ...(info.kind === undefined ? {} : { kind: info.kind }),
    commands: info.commands,
    state: info.state,
    ...(info.reason === undefined ? {} : { reason: info.reason }),
    enabled: installs.get(info.name)?.enabled ?? info.enabled,
    scopes: scopesOf.get(info.name) ?? [],
  }))
}

/**
 * Keys the plugin's own JSON Schema does not declare, mirroring the guard
 * `config/plugins.ts`'s `writeDeclaredSetting` applies one key at a time — duplicated
 * here so every key can be checked, and refused, before any of them is written.
 */
function undeclaredKeys(form: FormSchema, keys: readonly string[]): readonly string[] {
  if (!form.available) return []
  const schema = form.schema as { properties?: unknown, additionalProperties?: unknown }
  const properties: unknown = schema.properties
  const open = schema.additionalProperties !== undefined && schema.additionalProperties !== false
  if (open || typeof properties !== 'object' || properties === null) return []
  return keys.filter((key) => !Object.hasOwn(properties, key))
}

export function registerPluginRoutes(app: FastifyInstance, state: RuntimeState): void {
  app.get('/api/plugins', () => pluginsOf(state))

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
    const result = await enablePlugin(state.db, state.config.sporesDir, name)
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
    return await formSchemaOf(state.db, state.config.sporesDir, name)
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
    const form = await formSchemaOf(state.db, state.config.sporesDir, name)
    const bad = undeclaredKeys(form, keys)
    if (bad.length > 0) {
      throw badRequest('api.pluginSettingUndeclared', { plugin: name, keys: bad.join(', ') })
    }
    // Every key is declared, so the only thing left that can fail is the database itself —
    // one synchronous transaction makes that all-or-nothing. rewriteSetting is synchronous,
    // so it can run inside bun:sqlite's transaction(), which cannot await.
    state.db.transaction(() => {
      for (const [key, value] of Object.entries(body)) rewriteSetting(state.db, name, key, value)
    })
    return { ok: true, restartRequired: state.germination.status === 'germinated' }
  })
}

function requireInstalled(state: RuntimeState, name: string): void {
  if (getInstall(state.db, name) === null) throw notFound('api.pluginNotFound', { plugin: name })
}
