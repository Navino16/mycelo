import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import { ZodError } from 'zod'
import type { UiConfig } from '../config.js'
import type { RuntimeState } from '../boot/state.js'
import { ApiError } from './errors.js'
import { registerContext } from './context.js'
import { registerAuthRoutes } from './routes/auth.js'
import { describeThrown } from '../support/thrown.js'

export interface ServerOptions {
  trustProxy: boolean
  state: RuntimeState
}

/** Fastify's own faults (a malformed body, @fastify/rate-limit's 429) carry this, unlike ApiError. */
function statusCodeOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const status = (error as { statusCode?: unknown }).statusCode
  return typeof status === 'number' ? status : undefined
}

export function createServer(options: ServerOptions): FastifyInstance {
  const app = Fastify({ logger: false, trustProxy: options.trustProxy })
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) {
      void reply.status(error.status).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.detail === undefined ? {} : { detail: error.detail }),
        },
      })
      return
    }
    // §9: a route's own body/query is parsed through parseBody/parseQuery, which already wrap
    // a ZodError as `badRequest`. This is the fallback for a bare one that reaches here some
    // other way — core's own zod, never a plugin's, so `instanceof` is sound here.
    if (error instanceof ZodError) {
      void reply.status(400).send({
        error: { code: 'validation', message: 'the request is invalid', detail: error.issues },
      })
      return
    }
    const status = statusCodeOf(error) ?? 500
    void reply.status(status).send({
      error: { code: status === 429 ? 'rate-limited' : 'internal', message: describeThrown(error) },
    })
  })
  app.register(cookie)
  // global: false — only the login route is limited (spec §6.7). A global limiter would
  // throttle the UI's own polling, which TanStack Query does by design.
  app.register(rateLimit, { global: false })
  // Dataless and unauthenticated: it is the container probe (spec §17.5).
  app.get('/healthz', () => ({ ok: true }))
  // `onRoute` (which rate-limit reads `config.rateLimit` through) fires synchronously at
  // declaration time, unlike `register`, which defers its plugin body until boot. Declaring
  // /api/login before rate-limit has booted would silently register it with no limiter at all.
  app.after(() => {
    registerContext(app, options.state)
    registerAuthRoutes(app, options.state)
  })
  return app
}

/** Resolves the origin actually bound, which is what a port of 0 makes worth knowing. */
export async function startServer(app: FastifyInstance, ui: UiConfig): Promise<string> {
  await app.listen({ host: ui.bind, port: ui.port })
  const address = app.server.address()
  if (address === null || typeof address === 'string') {
    throw new Error(`the server bound to an unexpected address: ${String(address)}`)
  }
  return `http://${ui.bind}:${String(address.port)}`
}
