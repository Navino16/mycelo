import type {
  BroadcastResult,
  ConversationsRead,
  HealthRead,
  LocaleManage,
  MessagesBroadcast,
  MessagesSend,
  MyceliumScope,
  OutgoingContent,
  PluginsConfigure,
  PluginsRead,
  PluginsToggle,
  PrincipalsManage,
  PrincipalsRead,
  PushTarget,
  RestrictionsManage,
  RhizaHealth,
  RolesAssign,
  RolesManage,
  RolesRead,
} from '@mycelo/septum'
import {
  assignRole, createRole, deleteRole, listRoles, revokeRole, setRoleCommands,
} from './authorization/roles.js'
import {
  enableOrThrow, formSchemaOf, listPlugins, redactSecrets, writeDeclaredSetting,
} from './config/plugins.js'
import { setEnabled } from './config/store.js'
import {
  addBroadcastTarget, listBroadcastTargets, listConversations, removeBroadcastTarget,
} from './conversations/registry.js'
import type { Registry } from './germination/registry.js'
import {
  findByIdentity, listPrincipals, loadPrincipal, markReviewed, rolesOf, setDisplayName,
} from './identity/people.js'
import { canonicalLocale, setConversationLocale, setPrincipalLocale } from './i18n/locale.js'
import type { Translator } from './i18n/translator.js'
import type { Db } from './persistence/db.js'
import {
  clearContextRule, inhibitorChannels, listContextRules, setContextRule, setInhibitorChannels,
} from './restrictions/rules.js'
import { describeThrown } from './support/thrown.js'

async function aggregateHealth(registry: Registry): Promise<readonly RhizaHealth[]> {
  return Promise.all(registry.rhizas.map(async (r) => ({ rhiza: r.name, status: await r.instance.health() })))
}

// Defers the call into .then() so a throwing driver rejects the returned promise
// instead of throwing synchronously out of what the published contract says is async.
function toPromise<T>(fn: () => T): Promise<T> {
  return Promise.resolve().then(fn)
}

// Promise.all over per-target catches, never a bare Promise.all of the sends: one dead
// channel must not cancel the others, and the operator has to learn which one failed.
async function broadcast(
  db: Db,
  send: (target: PushTarget, content: OutgoingContent) => Promise<void>,
  content: OutgoingContent,
): Promise<readonly BroadcastResult[]> {
  return Promise.all(listBroadcastTargets(db).map(async (target): Promise<BroadcastResult> => {
    try {
      await send(target, content)
      return { target, ok: true }
    } catch (e) {
      return { target, ok: false, error: describeThrown(e) }
    }
  }))
}

export interface MyceliumApiOptions {
  /** Guards deleteRole against removing the role every first contact is given. */
  defaultRole?: string
  /** Required by locale.manage; createMyceliumApi throws if that scope is granted without it. */
  translator?: Translator
}

// The writer's guard the reader depends on: a locale nobody has a catalogue for would be
// stored, resolved, and then answer in the fallback with nothing to explain why.
function requireAvailable(translator: Translator, locale: string): string {
  const canonical = canonicalLocale(locale)
  const available = translator.availableLocales()
  if (!available.includes(canonical)) {
    throw new Error(`no catalogue provides '${canonical}'; available: ${available.join(', ') || 'none'}`)
  }
  return canonical
}

/**
 * Mounts one key per granted scope onto a fresh object — never the full API with keys
 * deleted — so a plugin without a scope has no property to find, not a rejected call.
 */
export function createMyceliumApi(
  registry: Registry,
  scopes: readonly MyceliumScope[],
  send: (target: PushTarget, content: OutgoingContent) => Promise<void>,
  db: Db,
  sporesDir: string,
  options?: MyceliumApiOptions,
): object {
  const { defaultRole, translator } = options ?? {}
  const granted = new Set(scopes)
  // No prototype: a global Object.prototype pollution must not forge an absent scope
  // as present through `in`, which is exactly how a caller is expected to check.
  const api = Object.create(null) as Partial<
    PluginsRead & HealthRead & MessagesSend & PrincipalsRead & PrincipalsManage &
    RolesRead & RolesAssign & RolesManage & PluginsToggle & PluginsConfigure &
    ConversationsRead & MessagesBroadcast & RestrictionsManage & LocaleManage
  >

  if (granted.has('plugins.read')) api.listPlugins = () => listPlugins(registry, sporesDir, db)
  if (granted.has('health.read')) api.health = () => aggregateHealth(registry)
  if (granted.has('messages.send')) api.send = send
  if (granted.has('conversations.read')) api.listConversations = () => toPromise(() => listConversations(db))
  if (granted.has('messages.broadcast')) api.broadcast = (content) => broadcast(db, send, content)

  if (granted.has('principals.read')) {
    api.listPrincipals = () => toPromise(() => listPrincipals(db))
    api.getPrincipal = (id) => toPromise(() => loadPrincipal(db, id))
    api.findByIdentity = (channel, externalId) => toPromise(() => findByIdentity(db, channel, externalId))
  }
  if (granted.has('principals.manage')) {
    api.markReviewed = (id) => toPromise(() => markReviewed(db, id))
    api.setDisplayName = (id, name) => toPromise(() => setDisplayName(db, id, name))
  }
  if (granted.has('roles.read')) {
    api.listRoles = () => toPromise(() => listRoles(db))
    api.rolesOf = (id) => toPromise(() => rolesOf(db, id))
  }
  if (granted.has('roles.assign')) {
    api.assignRole = (p, r) => toPromise(() => assignRole(db, p, r))
    api.revokeRole = (p, r) => toPromise(() => revokeRole(db, p, r))
  }
  if (granted.has('roles.manage')) {
    api.createRole = (name, patterns) => toPromise(() => createRole(db, name, patterns))
    api.setRoleCommands = (name, patterns) => toPromise(() => setRoleCommands(db, name, patterns))
    api.deleteRole = (name) => toPromise(() => deleteRole(db, name, defaultRole))
  }
  if (granted.has('plugins.toggle')) {
    api.enable = (name) => enableOrThrow(db, sporesDir, name)
    api.disable = (name) => toPromise(() => { setEnabled(db, name, false) })
  }
  if (granted.has('plugins.configure')) {
    api.settings = (name) => toPromise(() => redactSecrets(db, name))
    api.setSetting = (name, key, value) => writeDeclaredSetting(db, sporesDir, name, key, value)
    api.formSchema = (name) => formSchemaOf(db, sporesDir, name)
  }
  if (granted.has('restrictions.manage')) {
    api.listContextRules = () => toPromise(() => listContextRules(db))
    api.setContextRule = (pattern, where) => toPromise(() => { setContextRule(db, pattern, where) })
    api.clearContextRule = (pattern) => toPromise(() => { clearContextRule(db, pattern) })
    api.inhibitorChannels = (name) => toPromise(() => inhibitorChannels(db, name))
    api.setInhibitorChannels = (name, channels) => toPromise(() => { setInhibitorChannels(db, name, channels) })
    api.listBroadcastTargets = () => toPromise(() => listBroadcastTargets(db))
    api.addBroadcastTarget = (target) => toPromise(() => { addBroadcastTarget(db, target) })
    api.removeBroadcastTarget = (target) => toPromise(() => { removeBroadcastTarget(db, target) })
  }
  if (granted.has('locale.manage')) {
    // Fail fast rather than mounting a scope whose availableLocales() would answer [] —
    // an empty list that doubles as a meaningful value is a false report (phase 5.5).
    if (translator === undefined) throw new Error('locale.manage was granted with no translator')
    api.setPrincipalLocale = (id, locale) =>
      toPromise(() => { setPrincipalLocale(db, id, requireAvailable(translator, locale)) })
    api.setConversationLocale = (channel, conversationId, locale) =>
      toPromise(() => { setConversationLocale(db, channel, conversationId, requireAvailable(translator, locale)) })
    api.availableLocales = () => translator.availableLocales()
  }

  return api
}
