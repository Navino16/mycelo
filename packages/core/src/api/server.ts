import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import { fileURLToPath } from 'node:url'
import { ZodError } from 'zod'
import type { UiConfig } from '../config.js'
import type { RuntimeState } from '../boot/state.js'
import type { DriverFactory } from '../sporangium/driver.js'
import { ApiError, notFound } from './errors.js'
import { registerContext } from './context.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerConfigRoutes } from './routes/config.js'
import { registerHealthRoutes } from './routes/health.js'
import { registerPeopleRoutes } from './routes/people.js'
import { registerPluginRoutes } from './routes/plugins.js'
import { registerRegistryRoutes } from './routes/registry.js'
import { registerRoleRoutes } from './routes/roles.js'
import { registerSourceRoutes } from './routes/sources.js'
import { describeFault } from '../support/thrown.js'

// Both roots, tried in order: a real build the day phase 9 produces one, the committed
// sentinel until then. dist/ is gitignored, so public/ is the only one in the tree today.
const UI_ROOTS = [
  fileURLToPath(new URL('../../../ui/dist', import.meta.url)),
  fileURLToPath(new URL('../../../ui/public', import.meta.url)),
]

export interface ServerOptions {
  trustProxy: boolean
  state: RuntimeState
  /** Test seam only, never operator config: overrides UI_ROOTS to probe fallback order. */
  uiRoots?: string[]
  /** Test seam only: the browse and inoculate routes resolve a driver from the source row. */
  driverFor?: DriverFactory
}

/** Fastify's own faults (a malformed body, @fastify/rate-limit's 429) carry this, unlike ApiError. */
function statusCodeOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const status = (error as { statusCode?: unknown }).statusCode
  return typeof status === 'number' ? status : undefined
}

export function createServer(options: ServerOptions): FastifyInstance {
  const app = Fastify({ logger: false, trustProxy: options.trustProxy })
  // Read through `options.state` on every render, not destructured: germination replaces
  // `state.translator` once spore catalogues load, and a captured reference would miss it.
  app.setErrorHandler((error, request, reply) => {
    const { translator } = options.state
    if (error instanceof ApiError) {
      void reply.status(error.status).send({
        error: {
          code: error.code,
          message: translator.translate('core', error.key, request.locale, error.params),
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
        error: {
          code: 'validation',
          message: translator.translate('core', 'api.invalidRequest', request.locale),
          detail: error.issues,
        },
      })
      return
    }
    const status = statusCodeOf(error) ?? 500
    // §10 admits no exception, including this one: the raw fault (a SQLite sentence, an
    // invariant message) goes to the operator's log, never to the client. Also covers
    // StartupError/BootstrapError, neither reachable from a request handler today.
    // describeFault, not describeThrown: this line is the only record, so it keeps the stack.
    if (status !== 429) console.error(describeFault(error))
    void reply.status(status).send({
      error: {
        code: status === 429 ? 'rate-limited' : 'internal',
        message: translator.translate(
          'core', status === 429 ? 'api.rateLimited' : 'api.internalError', request.locale,
        ),
      },
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
    registerHealthRoutes(app, options.state)
    registerConfigRoutes(app, options.state)
    registerPeopleRoutes(app, options.state)
    registerPluginRoutes(app, options.state)
    registerRoleRoutes(app, options.state)
    registerRegistryRoutes(app, options.state)
    registerSourceRoutes(app, options.state, options.driverFor)
    // wildcard: false — the plugin claims only the files it finds under UI_ROOTS, so the
    // fallback below still runs for every SPA route and API 404 (spec §12).
    void app.register(fastifyStatic, { root: options.uiRoots ?? UI_ROOTS, wildcard: false })
    app.setNotFoundHandler((request, reply) => {
      const path = request.url.split('?')[0] ?? ''
      if (path.startsWith('/api/') || path === '/healthz') {
        throw notFound('api.routeNotFound', { path })
      }
      // SPA fallback: the client router owns every other path (spec §12).
      void reply.sendFile('index.html')
    })
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
