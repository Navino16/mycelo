import type { FastifyInstance } from 'fastify'
import type { RuntimeState } from '../../boot/state.js'
import { retryGermination } from '../../boot/germinate.js'
import { aggregateRuntimeHealth } from '../../supervision/health.js'
import { createLogger } from '../../support/logger.js'
import { degradedError } from '../errors.js'

export function registerHealthRoutes(app: FastifyInstance, state: RuntimeState): void {
  app.get('/api/health', () => aggregateRuntimeHealth(state.germination))

  app.post('/api/germination/retry', async () => {
    // The check is repeated in retryGermination as a plain Error: the route owns the HTTP
    // code, and the state function must not be callable into an unsafe retry by a future
    // caller that forgets it (the writer's guard the reader also needs).
    if (state.germination.status !== 'degraded') {
      throw degradedError('api.germinationNotDegraded')
    }
    await retryGermination(state, createLogger())
    return aggregateRuntimeHealth(state.germination)
  })
}
