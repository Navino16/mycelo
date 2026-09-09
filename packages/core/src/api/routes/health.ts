import type { FastifyInstance } from 'fastify'
import type { RuntimeState } from '../../boot/state.js'
import { retryGermination } from '../../boot/germinate.js'
import { aggregateRuntimeHealth } from '../../supervision/health.js'
import type { RuntimeHealth } from '../../supervision/health.js'
import { renderRefusal } from '../../i18n/refusal.js'
import type { Translator } from '../../i18n/translator.js'
import { createLogger } from '../../support/logger.js'
import { degradedError } from '../errors.js'

/**
 * `RuntimeHealth` with its `dormant` verdicts rendered at the request locale (design §2.2,
 * §3) — never widen `RuntimeHealth` itself, which is the runtime's own shape and carries refs.
 */
export interface RuntimeHealthDto extends Omit<RuntimeHealth, 'dormant'> {
  dormant: readonly { name: string, reason: string, reasonKey: string }[]
}

function renderHealth(health: RuntimeHealth, translator: Translator, locale: string): RuntimeHealthDto {
  return {
    ...health,
    dormant: health.dormant.map((d) => ({
      name: d.name,
      reason: renderRefusal(translator, d.refusal, locale),
      reasonKey: d.refusal.key,
    })),
  }
}

export function registerHealthRoutes(app: FastifyInstance, state: RuntimeState): void {
  app.get('/api/health', async (request) => renderHealth(
    await aggregateRuntimeHealth(
      state.germination, state.config.discoveryDirs, state.db, state.translator, request.locale,
    ),
    state.translator, request.locale,
  ))

  app.post('/api/germination/retry', async (request) => {
    // The check is repeated in retryGermination as a plain Error: the route owns the HTTP
    // code, and the state function must not be callable into an unsafe retry by a future
    // caller that forgets it (the writer's guard the reader also needs).
    if (state.germination.status !== 'degraded') {
      throw degradedError('api.germinationNotDegraded')
    }
    await retryGermination(state, createLogger())
    return renderHealth(
      await aggregateRuntimeHealth(
        state.germination, state.config.discoveryDirs, state.db, state.translator, request.locale,
      ),
      state.translator, request.locale,
    )
  })
}
