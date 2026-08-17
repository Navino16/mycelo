import { createServer, startServer } from '../api/server.js'
import { BootstrapError } from '../config.js'
import { StartupError } from '../identity/bootstrap.js'
import { DatabaseError } from '../persistence/db.js'
import { createLogger } from '../support/logger.js'
import { describeThrown } from '../support/thrown.js'
import { germinatePhase } from './germinate.js'
import { serve } from './serve.js'
import type { RuntimeState } from './state.js'

export interface Running {
  state: RuntimeState
  /** The origin actually bound, which is what a configured port of 0 makes worth knowing. */
  address: string
  close: () => Promise<void>
}

/**
 * A configuration mistake is the operator's to fix, so it gets a sentence. Anything
 * else is ours, so it keeps its stack.
 */
export function startupMessage(e: unknown): string {
  if (e instanceof BootstrapError || e instanceof StartupError || e instanceof DatabaseError) {
    return `mycelo cannot start: ${e.message}`
  }
  if (e instanceof Error) return `mycelo cannot start: ${e.stack ?? e.message}`
  return `mycelo cannot start: ${describeThrown(e)}`
}

/**
 * The entry point's body. The server listens before germination runs, which is the whole
 * of "the UI always starts" (spec §2.1). A germination fault degrades rather than throwing;
 * a substrate fault propagates, so the port and the handle opened above are released first.
 */
export async function runEntry(configFile: string): Promise<Running> {
  const logger = createLogger()
  const { state, closeDb } = serve(configFile)
  const app = createServer({ trustProxy: state.config.ui.trustProxy })
  let closed = false
  const close = async (): Promise<void> => {
    // SIGINT and SIGTERM can both arrive, so idempotence is stated here rather than left to
    // whether app.close() and the sqlite handle happen to tolerate a second call.
    if (closed) return
    closed = true
    await app.close()
    // Refuses every further query. It does not release the file descriptor or the -wal
    // sibling — a known db.ts defect, not this call's to fix.
    closeDb()
  }
  try {
    const address = await startServer(app, state.config.ui)
    logger.info(`api listening on ${address}`)
    await germinatePhase(state, logger)
    return { state, address, close }
  } catch (e) {
    await close()
    throw e
  }
}
