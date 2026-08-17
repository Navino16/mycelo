import { createServer, startServer } from '../api/server.js'
import { BootstrapError } from '../config.js'
import { StartupError } from '../identity/bootstrap.js'
import { DatabaseError } from '../persistence/db.js'
import { createLogger } from '../support/logger.js'
import { germinatePhase } from './germinate.js'
import { serve } from './serve.js'
import { stopMycelium } from './start.js'
import type { RuntimeState } from './state.js'

export interface Running {
  state: RuntimeState
  /** Carried rather than rebuilt by callers: server.ts owns the `http://host:port` format. */
  address: string
  close: () => Promise<void>
}

/**
 * A configuration mistake is the operator's to fix, so it gets a sentence. Anything else is
 * ours, so it keeps its stack — and a non-Error keeps its own text, which is the only clue
 * a `throw 'string'` from a dependency leaves.
 */
function failureDetail(e: unknown): string {
  if (e instanceof BootstrapError || e instanceof StartupError || e instanceof DatabaseError) {
    return e.message
  }
  if (e instanceof Error) return e.stack ?? e.message
  return String(e)
}

export function startupMessage(e: unknown): string {
  return `mycelo cannot start: ${failureDetail(e)}`
}

export function shutdownMessage(e: unknown): string {
  return `mycelo did not shut down cleanly: ${failureDetail(e)}`
}

/**
 * The entry point's body. The server listens before germination runs, which is the whole
 * of "the UI always starts" (spec §2.1). A germination fault degrades rather than throwing;
 * a substrate fault propagates, so the port and the handle opened above are released first.
 */
export async function runEntry(configFile: string): Promise<Running> {
  const logger = createLogger()
  const { state, closeDb } = serve(configFile)
  const app = createServer({ trustProxy: state.config.ui.trustProxy, state })
  let closed = false
  const close = async (): Promise<void> => {
    // Set before the first await: index.ts registers both signal handlers on this closure,
    // so SIGINT and SIGTERM in the same tick would otherwise run two concurrent shutdowns.
    if (closed) return
    closed = true
    // Spores stop before Fastify and the database: a plugin's stop() may still write to
    // the database (a channel recording its last-seen cursor), so the handle must be open.
    if (state.germination.status === 'germinated') {
      await stopMycelium(state.germination.mycelium, logger)
    }
    // Requests stop before the handle goes (api-design §12): the reverse order would let a
    // route that reads the database fault mid-shutdown instead of being refused at the socket.
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
    // Swallowed deliberately: a cleanup failure must not replace the fault the operator needs.
    try { await close() } catch { /* the original error is the one that matters */ }
    throw e
  }
}
