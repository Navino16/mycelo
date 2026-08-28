import type { ChannelCapability, CommandInfo, CommandScope, Principal } from '@mycelo/septum'
import type { Registry } from '../germination/registry.js'
import type { Translator } from '../i18n/translator.js'
import type { Db } from '../persistence/db.js'
import { patternsOf } from '../identity/resolve.js'
import { contextRules } from '../restrictions/rules.js'
import { authorize } from './check.js'

/**
 * design §6. Sorted by `qualified` rather than left in buildRoutes' discovery order, which
 * is an accident of the spores directory. The domain passed to translate() is the command's
 * own plugin, not the caller's.
 *
 * With `where`, the two gates the bus applies at dispatch are applied here too (bus.ts:268 and
 * bus.ts:277). Not the third: `registry.routes` here is germination's map, while the bus routes
 * from the one boot/start.ts rebuilds from the enzymes that actually started — so a command whose
 * enzyme's start() threw is still listed. Without `where`, authorization alone (spec §7).
 */
export function availableCommands(
  registry: Registry,
  db: Db,
  translator: Translator,
  principal: Principal,
  locale: string,
  where?: CommandScope,
): readonly CommandInfo[] {
  const patterns = patternsOf(db, principal.id)
  // Only read when a scope is given: available.test.ts builds a partial Registry cast, and
  // an unknown channel must declare nothing, as bus.ts:268's undefined hypha does.
  const declared: readonly ChannelCapability[] | undefined = where === undefined
    ? undefined
    : registry.hyphae.find((hypha) => hypha.name === where.channel)?.manifest.capabilities ?? []
  const ruleFor = where?.kind === undefined ? undefined : contextRules(db)
  return [...registry.routes.values()]
    .filter((route) => authorize(route.qualified, patterns))
    .filter((route) => declared === undefined
      || (route.spec.capabilities ?? []).every((capability) => declared.includes(capability)))
    .filter((route) => {
      if (ruleFor === undefined) return true
      const rule = ruleFor(route.qualified)
      return rule === null || rule === where?.kind
    })
    .sort((a, b) => (a.qualified < b.qualified ? -1 : a.qualified > b.qualified ? 1 : 0))
    .map((route) => ({
      qualified: route.qualified,
      name: route.command,
      plugin: route.plugin,
      description: translator.translate(route.plugin, route.spec.description, locale),
      ...(route.spec.args === undefined ? {} : {
        args: route.spec.args.map((arg) => ({
          name: arg.name,
          description: translator.translate(route.plugin, arg.description, locale),
          required: arg.required,
        })),
      }),
    }))
}
