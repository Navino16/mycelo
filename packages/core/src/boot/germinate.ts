import type { Logger } from '@mycelo/septum'
import { syncInstalls } from '../config/lifecycle.js'
import { readAllSettings } from '../config/store.js'
import { germinate } from '../germination/germinate.js'
import type { Catalogs } from '../i18n/catalog.js'
import { loadCoreCatalogs } from '../i18n/core-catalogs.js'
import { createTranslator } from '../i18n/translator.js'
import { startMycelium } from './start.js'
import { classifyGerminationFailure } from './state.js'
import type { Germination, RuntimeState } from './state.js'

/**
 * Phase 2 (spec §2.2). Never throws: a cycle or a collision becomes a degraded state,
 * because the remedy for both is a UI action and a dead process would lock it out (§8.1).
 */
export async function germinatePhase(state: RuntimeState, logger: Logger): Promise<Germination> {
  try {
    const { config, db } = state
    const { added } = syncInstalls(db, config.sporesDir)
    if (added.length > 0) logger.info(`recorded ${String(added.length)} spore(s): ${added.join(', ')}`)
    const registry = await germinate(config.sporesDir, logger, readAllSettings(db), db)
    // Spore-first would let a plugin shadow the core's own domain; germination already
    // refuses those two names, so the order here is belt and braces.
    const catalogs: Catalogs = new Map([...registry.catalogs, ...loadCoreCatalogs()])
    state.translator = createTranslator({ catalogs, defaultLocale: config.defaultLocale, logger })
    const mycelium = await startMycelium({ registry, state, logger })
    state.germination = { status: 'germinated', mycelium }
  } catch (e) {
    const failure = classifyGerminationFailure(e)
    logger.error(`germination failed; the API stays up in degraded mode: ${failure.message}`)
    state.germination = { status: 'degraded', failure }
  }
  return state.germination
}
