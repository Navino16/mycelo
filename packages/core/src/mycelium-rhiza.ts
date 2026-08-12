import type {
  HealthRead,
  MessagesSend,
  MyceliumScope,
  OutgoingContent,
  PluginInfo,
  PluginsRead,
  PushTarget,
  RhizaHealth,
} from '@mycelo/septum'
import type { Registry } from './germination/registry.js'

function listPlugins(registry: Registry): readonly PluginInfo[] {
  const germinated: PluginInfo[] = [
    ...registry.hyphae.map((h) => ({ name: h.name, kind: h.manifest.kind, commands: [], state: 'germinated' as const })),
    ...registry.enzymes.map((e) => ({
      name: e.name,
      kind: e.manifest.kind,
      commands: e.manifest.commands.map((c) => c.name),
      state: 'germinated' as const,
    })),
    ...registry.rhizas.map((r) => ({ name: r.name, kind: r.manifest.kind, commands: [], state: 'germinated' as const })),
  ]
  // Dormant carries no kind: a spore may fail before its manifest ever parses.
  const dormant: PluginInfo[] = registry.dormant.map((d) => ({
    name: d.name,
    commands: [],
    state: 'dormant' as const,
    reason: d.reason,
  }))
  return [...germinated, ...dormant]
}

async function aggregateHealth(registry: Registry): Promise<readonly RhizaHealth[]> {
  return Promise.all(registry.rhizas.map(async (r) => ({ rhiza: r.name, status: await r.instance.health() })))
}

/**
 * Mounts one key per granted scope onto a fresh object — never the full API with keys
 * deleted — so a plugin without a scope has no property to find, not a rejected call.
 */
export function createMyceliumApi(
  registry: Registry,
  scopes: readonly MyceliumScope[],
  send: (target: PushTarget, content: OutgoingContent) => Promise<void>,
): object {
  const granted = new Set(scopes)
  // No prototype: a global Object.prototype pollution must not forge an absent scope
  // as present through `in`, which is exactly how a caller is expected to check.
  const api = Object.create(null) as Partial<PluginsRead & HealthRead & MessagesSend>

  if (granted.has('plugins.read')) api.listPlugins = () => listPlugins(registry)
  if (granted.has('health.read')) api.health = () => aggregateHealth(registry)
  if (granted.has('messages.send')) api.send = send

  return api
}
