import { deleteAllCredentials } from '../api/credentials.js'
import { sweepSessions } from '../api/sessions.js'
import { loadBootstrap } from '../config.js'
import { assertCoreCatalogs, loadCoreCatalogs } from '../i18n/core-catalogs.js'
import { createTranslator } from '../i18n/translator.js'
import { bootstrapIdentity } from '../identity/bootstrap.js'
import { migrateDatabase, openDatabase } from '../persistence/db.js'
import { uiSession } from '../persistence/schema.js'
import { createLogger } from '../support/logger.js'
import { createRuntimeState } from './state.js'
import type { RuntimeState } from './state.js'

export interface Served {
  state: RuntimeState
  closeDb: () => void
}

/**
 * Phase 1 (spec §2.1). Fatal if it fails: with no database there is no authorization,
 * so failing open is worse than not starting (spec §5). The translator exists before
 * phase 2 so a germination failure has one to render its own diagnostic with.
 */
export function serve(configFile: string): Served {
  const logger = createLogger()
  const config = loadBootstrap(configFile)
  const { db, close } = openDatabase(config.databaseFile)
  try {
    migrateDatabase(db)
    bootstrapIdentity(db, { owner: config.owner, defaultRole: config.defaultRole })
    if (config.ui.resetAccount) {
      const removed = deleteAllCredentials(db)
      db.delete(uiSession).run()
      logger.warn(`ui.resetAccount removed ${String(removed)} UI credential(s) and every session; the setup wizard will run again — remove the key once you are back in`)
    }
    sweepSessions(db)
    // Cannot live in germinatePhase: everything inside its `try` is non-fatal by
    // construction, so a StartupError there would degrade instead of halting and the API
    // would come up rendering every string as a raw catalogue key.
    const catalogs = loadCoreCatalogs()
    assertCoreCatalogs(catalogs, config.defaultLocale)
    const translator = createTranslator({ catalogs, defaultLocale: config.defaultLocale, logger })
    return { state: createRuntimeState(config, db, translator), closeDb: close }
  } catch (e) {
    // catch, not finally: on the success path the caller receives the handle and owns it.
    close()
    throw e
  }
}
