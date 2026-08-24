import type { Logger } from '@mycelo/septum'
import type { OwnerIdentity } from '../config.js'
import { syncInstalls } from '../config/lifecycle.js'
import { readAllSettings } from '../config/store.js'
import { assertNoCollisions } from '../germination/discover.js'
import { germinate } from '../germination/germinate.js'
import type { Registry } from '../germination/registry.js'
import type { Catalogs } from '../i18n/catalog.js'
import { loadCoreCatalogs } from '../i18n/core-catalogs.js'
import { createTranslator } from '../i18n/translator.js'
import { startMycelium } from './start.js'
import { classifyGerminationFailure } from './state.js'
import type { Germination, RuntimeState } from './state.js'

/**
 * The owner principal always exists (bootstrapIdentity), but nobody can send as it
 * when no hypha germinated for its channel. A warning, not a throw: the fix is a UI
 * action (`POST /api/people/:id/roles`), and a fault a UI action repairs must not
 * kill the process.
 */
function warnUninhabitableOwner(
  owner: OwnerIdentity | undefined,
  registry: Registry,
  logger: Logger,
): void {
  if (owner === undefined) return
  if (registry.hyphae.some((h) => h.name === owner.channel)) return
  logger.warn(
    `the configured owner is on channel '${owner.channel}', which no germinated hypha provides`,
    { userId: owner.userId, germinated: registry.hyphae.map((h) => h.name) },
  )
}

/**
 * Phase 2 (spec §2.2). Never throws for a germination fault: a cycle or a collision becomes
 * a degraded state, because the remedy for both is a UI action and a dead process would lock
 * it out (§8.1). A substrate fault still propagates and is fatal.
 */
export async function germinatePhase(state: RuntimeState, logger: Logger): Promise<Germination> {
  const { config, db } = state
  // Outside the `try`: degraded mode exists for faults a UI action repairs (§8.1), and no
  // screen repairs an unwritable database — serving an API over one only buys a bot that
  // answers HTTP while its authorization tables are unreadable. A collision is a startup
  // failure for the same reason (design §4.2).
  assertNoCollisions(config.sporesDirs)
  const { added } = syncInstalls(db, config.sporesDirs)
  if (added.length > 0) logger.info(`recorded ${String(added.length)} spore(s): ${added.join(', ')}`)
  const settings = readAllSettings(db)
  try {
    const registry = await germinate(config.sporesDirs, logger, settings, db)
    // Spore-first would let a plugin shadow the core's own domain; germination already
    // refuses those two names, so the order here is belt and braces.
    const catalogs: Catalogs = new Map([...registry.catalogs, ...loadCoreCatalogs()])
    state.translator = createTranslator({ catalogs, defaultLocale: config.defaultLocale, logger })
    warnUninhabitableOwner(config.owner, registry, logger)
    const mycelium = await startMycelium({ registry, state, logger })
    state.germination = { status: 'germinated', mycelium }
  } catch (e) {
    const failure = classifyGerminationFailure(e)
    logger.error(`germination failed; the API stays up in degraded mode: ${failure.message}`)
    // GerminationFailure carries no class and no stack, and index.ts prints no failure detail
    // of its own, so without this an unclassified throw reaches the operator as a bare message.
    if (failure.kind === 'unknown') {
      logger.error('unclassified germination failure', {
        thrown: e instanceof Error ? (e.stack ?? e.name) : typeof e,
      })
    }
    state.germination = { status: 'degraded', failure }
  }
  return state.germination
}

/**
 * Only from degraded mode (spec §4.2): nothing germinated, so nothing needs stopping.
 * A retry from `germinated` would have to tear a live channel connection down.
 */
export async function retryGermination(state: RuntimeState, logger: Logger): Promise<Germination> {
  if (state.germination.status !== 'degraded') {
    throw new Error('germination can only be retried while the runtime is degraded')
  }
  state.retrying ??= germinatePhase(state, logger).finally(() => { state.retrying = undefined })
  return state.retrying
}
