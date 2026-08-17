import { createLogger } from '../support/logger.js'
import { germinatePhase } from './germinate.js'
import { serve } from './serve.js'
import type { Mycelium } from './start.js'

/**
 * The single-call form every phase before the API uses. Rejects when germination
 * degrades, so a caller that expected a working registry still fails.
 */
export async function bootstrap(configFile: string): Promise<Mycelium> {
  const { state } = serve(configFile)
  const result = await germinatePhase(state, createLogger())
  if (result.status !== 'germinated') {
    const reason = result.status === 'degraded' ? result.failure.message : 'germination did not run'
    throw new Error(reason)
  }
  return result.mycelium
}
