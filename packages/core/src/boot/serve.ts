import { loadBootstrap } from '../config.js'
import { assertCoreCatalogs, loadCoreCatalogs } from '../i18n/core-catalogs.js'
import { createTranslator } from '../i18n/translator.js'
import { bootstrapIdentity } from '../identity/bootstrap.js'
import { migrateDatabase, openDatabase } from '../persistence/db.js'
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
  migrateDatabase(db)
  bootstrapIdentity(db, { owner: config.owner, defaultRole: config.defaultRole })
  // Asserted on the core catalogues alone, which is equivalent to asserting the merged
  // map: germination merges core last, so core and common are always exactly these.
  const catalogs = loadCoreCatalogs()
  assertCoreCatalogs(catalogs, config.defaultLocale)
  const translator = createTranslator({ catalogs, defaultLocale: config.defaultLocale, logger })
  return { state: createRuntimeState(config, db, translator), closeDb: close }
}
