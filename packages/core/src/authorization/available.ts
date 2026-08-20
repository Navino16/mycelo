import type { CommandInfo, Principal } from '@mycelo/septum'
import type { Registry } from '../germination/registry.js'
import type { Translator } from '../i18n/translator.js'
import type { Db } from '../persistence/db.js'
import { patternsOf } from '../identity/resolve.js'
import { authorize } from './check.js'

/**
 * design §6. Sorted by `qualified` rather than left in buildRoutes' discovery order, which
 * is an accident of the spores directory. The domain passed to translate() is the command's
 * own plugin, not the caller's. Filters on authorization alone: the bus's capability and
 * context-rule gates need a channel this signature does not carry.
 */
export function availableCommands(
  registry: Registry,
  db: Db,
  translator: Translator,
  principal: Principal,
  locale: string,
): readonly CommandInfo[] {
  const patterns = patternsOf(db, principal.id)
  return [...registry.routes.values()]
    .filter((route) => authorize(route.qualified, patterns))
    .sort((a, b) => (a.qualified < b.qualified ? -1 : a.qualified > b.qualified ? 1 : 0))
    .map((route) => ({
      qualified: route.qualified,
      name: route.command,
      plugin: route.plugin,
      description: translator.translate(route.plugin, route.spec.description, locale),
    }))
}
