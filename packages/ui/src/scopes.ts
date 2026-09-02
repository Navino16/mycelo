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
