import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
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
import { managedRoot, sweepStaging } from '../sporangium/inoculate.js'
import { seedOfficialSource, upsertLocalSource } from '../sporangium/sources.js'
import { describeThrown } from '../support/thrown.js'
import { startMycelium } from './start.js'
import { classifyGerminationFailure } from './state.js'
import type { Germination, RuntimeState } from './state.js'

/**
 * The owner principal always exists (bootstrapIdentity), but nobody can send as it
 * when no hypha germinated for its channel. A warning, not a throw: the fix is a UI
 * action (`POST /api/people/:id/roles`), which a dead process would block.
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
  seedOfficialSource(db)
  // mycelo.yaml stays the authority; the rows are a mirror the UI renders §7.4's warning
  // against. The managed root gets none: it is the core's, not a hand-edited one.
  for (const dir of config.sporesDirs) upsertLocalSource(db, resolve(dir))
  const managed = resolve(managedRoot(config.databaseFile))
  // Never fatal: what a crashed install left sits two levels down, invisible to discover(),
  // so failing to remove it must not stop the bot from booting.
  try {
    sweepStaging(managed)
  } catch (e) {
    logger.warn('could not remove the managed root\'s staging directory', { error: describeThrown(e) })
  }
  // Only once it exists — before the first inoculate there is nothing there and germinate()
  // would report it as a misconfigured root — and never twice, when a configured root is it.
  const sporesDirs = existsSync(managed) && !config.sporesDirs.some((dir) => resolve(dir) === managed)
    ? [...config.sporesDirs, managed]
    : config.sporesDirs
  assertNoCollisions(sporesDirs)
  const { added } = syncInstalls(db, sporesDirs)
  if (added.length > 0) logger.info(`recorded ${String(added.length)} spore(s): ${added.join(', ')}`)
  const settings = readAllSettings(db)
  try {
    const registry = await germinate(sporesDirs, logger, settings, db)
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
