import type { TranslatableRef } from '@mycelo/septum'
import { SHARED_DOMAIN } from './core-catalogs.js'

/**
 * Every refusal key the core authors, with the parameter names its `common` message
 * interpolates. Two pins hang off it: `refusalRef` makes a producer's bag a compile error when
 * it drifts, and `core-catalogs.test.ts` compares each entry against the compiled message in
 * every locale. Without both, a bag missing one name makes `@formatjs` throw and the refusal
 * renders as its own dotted key — green everywhere, since every assertion is on a string.
 */
export const REFUSAL_PARAMS = {
  'refusal.plugin.notInstalled': ['plugin'],
  'refusal.plugin.notOnDisk': ['plugin'],
  'refusal.plugin.unreadableManifest': ['plugin', 'detail'],
  'refusal.plugin.septumIncompatible': ['plugin', 'detail'],
  'refusal.plugin.loadFailed': ['plugin', 'detail'],
  'refusal.plugin.settingUndeclared': ['plugin', 'count', 'keys'],
  'refusal.role.notFound': ['role'],
  'refusal.role.exists': ['role'],
  'refusal.role.builtin': ['role'],
  'refusal.role.isDefault': ['role'],
  'refusal.role.nameEmpty': [],
  'refusal.role.patternDuplicate': ['pattern'],
  'refusal.person.notFound': ['id'],
  'refusal.config.invalidType': ['expected'],
  'refusal.config.tooSmall': ['origin', 'minimum'],
  'refusal.config.tooSmallExclusive': ['origin', 'minimum'],
  'refusal.config.tooBig': ['origin', 'maximum'],
  'refusal.config.tooBigExclusive': ['origin', 'maximum'],
  'refusal.config.invalidFormat': ['format'],
  'refusal.config.invalidValue': ['values'],
  'refusal.config.notMultipleOf': ['divisor'],
  'refusal.config.unrecognizedKeys': ['keys'],
  'refusal.config.issueAt': ['field', 'cause'],
  'refusal.config.incomplete': ['issues'],
  'refusal.config.validationThrew': ['detail'],
  'refusal.config.undeclaredSecrets': ['count', 'keys'],
  'refusal.germination.reservedDomain': ['plugin'],
  'refusal.germination.reservedName': [],
  'refusal.germination.duplicateName': ['plugin', 'claimant', 'duplicate'],
  'refusal.germination.requiredRhizaMissing': ['rhiza'],
  'refusal.germination.requiredRhizaWrongKind': ['rhiza', 'kind'],
  'refusal.germination.anyOfNoneInstalled': ['alternatives'],
  'refusal.germination.dependencyDormant': ['rhiza', 'cause'],
  'refusal.germination.anyOfDependencyDormant': ['alternatives', 'chosen', 'cause'],
  'refusal.germination.scopeNotMounted': ['scope'],
  'refusal.germination.scopeLaterPhase': ['scope', 'phase'],
  'refusal.germination.catalogFailed': ['detail'],
  'refusal.germination.moduleCreateThrew': ['detail'],
  'refusal.germination.invalidManifest': ['path', 'detail'],
  'refusal.germination.invalidManifestNoPath': ['detail'],
  'refusal.germination.createNotObject': ['got'],
  'refusal.germination.createMissingMethods': ['missing'],
  'refusal.germination.rhizaNoApi': [],
  'refusal.germination.enzymeNoHandlersObject': [],
  'refusal.germination.handlersMissing': ['missing'],
  'refusal.germination.startStopMismatch': [],
  'refusal.germination.inhibitorNoInspect': [],
  'refusal.germination.methodNotCallable': ['method'],
  'refusal.germination.capabilityUnimplemented': [],
  'refusal.germination.capabilityUndeclared': [],
  'refusal.startup.hyphaConnectFailed': ['detail'],
  'refusal.startup.hyphaListenFailed': ['detail'],
  'refusal.startup.startFailed': ['detail'],
} as const satisfies Record<string, readonly string[]>

export type RefusalKey = keyof typeof REFUSAL_PARAMS

type Names<K extends RefusalKey> = (typeof REFUSAL_PARAMS)[K][number]

/**
 * `unknown` per name, not a value type: a parameter may be a nested `TranslatableRef`, an array
 * of them, a number or a string. Excess-property checking on the literal is what rejects a name
 * no message interpolates.
 */
export type ParamsFor<K extends RefusalKey> = Record<Names<K>, unknown>

/** A key whose message takes no parameter is called with one argument, not with `{}`. */
export type RefusalArgs<K extends RefusalKey> = [Names<K>] extends [never] ? [] : [ParamsFor<K>]

/**
 * Every refusal the core authors resolves in `common`: germination has no spore binding to
 * enforce `requires` with, and design §5.3 accepts no other domain there.
 */
export function refusalRef<K extends RefusalKey>(key: K, ...params: RefusalArgs<K>): TranslatableRef {
  const bag = params[0] as Record<string, unknown> | undefined
  return { domain: SHARED_DOMAIN, key, ...(bag === undefined ? {} : { params: bag }) }
}
