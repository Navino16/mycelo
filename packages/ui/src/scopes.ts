import type { StringKey } from '../locales/en.ts'

/**
 * Mirrors packages/septum/src/mycelium.ts's MYCELIUM_SCOPES: this package has no septum
 * dependency (api/types.ts), so the sixteen names are redeclared here purely for `satisfies`
 * completeness checking below.
 */
type MyceliumScope =
  | 'principals.read' | 'principals.manage' | 'roles.read' | 'roles.assign' | 'roles.manage'
  | 'plugins.read' | 'plugins.toggle' | 'plugins.configure' | 'health.read'
  | 'messages.send' | 'messages.broadcast' | 'conversations.read' | 'restrictions.manage'
  | 'locale.manage' | 'commands.read' | 'sources.manage'

/**
 * One sentence per MYCELIUM_SCOPES member. Declared `Record<string, StringKey>` so a lookup
 * against a scope this file has not caught up with is `undefined`, not a type error — but
 * checked with `satisfies` against the sixteen-name union, so omitting one fails to compile.
 */
export const SCOPE_SENTENCE: Record<string, StringKey> = {
  'principals.read': 'scope.principals.read',
  'principals.manage': 'scope.principals.manage',
  'roles.read': 'scope.roles.read',
  'roles.assign': 'scope.roles.assign',
  'roles.manage': 'scope.roles.manage',
  'plugins.read': 'scope.plugins.read',
  'plugins.toggle': 'scope.plugins.toggle',
  'plugins.configure': 'scope.plugins.configure',
  'health.read': 'scope.health.read',
  'messages.send': 'scope.messages.send',
  'messages.broadcast': 'scope.messages.broadcast',
  'conversations.read': 'scope.conversations.read',
  'restrictions.manage': 'scope.restrictions.manage',
  'locale.manage': 'scope.locale.manage',
  'commands.read': 'scope.commands.read',
  'sources.manage': 'scope.sources.manage',
} satisfies Record<MyceliumScope, StringKey>

export type ScopeRisk = 'low' | 'high'

/**
 * High for any scope that can widen someone's rights or reach a credential; low otherwise.
 * A UI judgement, not a core one — the manifest grades nothing (inventory §2 2b).
 */
export const SCOPE_RISK: Record<string, ScopeRisk> = {
  'principals.read': 'low',
  'principals.manage': 'high',
  'roles.read': 'low',
  'roles.assign': 'high',
  'roles.manage': 'high',
  'plugins.read': 'low',
  // It can disable the enforcing inhibitor and mute the bot.
  'plugins.toggle': 'high',
  // It reaches every stored credential.
  'plugins.configure': 'high',
  'health.read': 'low',
  'messages.send': 'low',
  // It speaks on every channel at once.
  'messages.broadcast': 'high',
  'conversations.read': 'low',
  'restrictions.manage': 'high',
  'locale.manage': 'low',
  'commands.read': 'low',
  // It decides where code comes from.
  'sources.manage': 'high',
} satisfies Record<MyceliumScope, ScopeRisk>

/**
 * The declared order is kept: the consent alert names them as the manifest asks for them.
 * A scope this file has not caught up with grades high — an ungraded one cannot be promised
 * harmless.
 */
export function highRiskScopes(scopes: readonly string[]): readonly string[] {
  return scopes.filter((scope) => (SCOPE_RISK[scope] ?? 'high') === 'high')
}

/** What `ScopeTable` and the consent alert paint a row with. */
export function riskOf(scope: string): ScopeRisk { return SCOPE_RISK[scope] ?? 'high' }
