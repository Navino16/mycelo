import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { RuntimeState } from '../boot/state.js'
import { eq } from 'drizzle-orm'
import { hasCredential } from './credentials.js'
import { SESSION_COOKIE, readSession } from './sessions.js'
import { setupRequired, unauthenticated } from './errors.js'
import { canonicalLocale } from '../i18n/locale.js'
import { principal } from '../persistence/schema.js'

// Reachable before an account exists (spec §6.4), plus the container probe. Neither of
// these needs a session either.
const OPEN_PATHS = new Set(['/healthz', '/api/setup'])
// Needs no session, but still refused by the setup lock: a route that required a session
// to reach would make logging in impossible, but it must not jump the §6.4 queue.
const SESSION_EXEMPT = new Set(['/api/login'])

declare module 'fastify' {
  interface FastifyRequest {
    principalId?: string
    locale: string
  }
}

export function registerContext(app: FastifyInstance, state: RuntimeState): void {
  app.decorateRequest('principalId', undefined)
  app.decorateRequest('locale', '')

  // Registered before the gate below, so the setup lock's 503 and the session check's 401 —
  // both thrown from that later onRequest hook — always have a locale to render with.
  // Header-only, no query: neither refusal has a valid principal by definition, so this is
  // the final answer for both, not a placeholder (task 10.5 review, Important 1).
  app.addHook('onRequest', (request, _reply, done) => {
    const path = request.url.split('?')[0] ?? ''
    // §17.5: the container probe stays dataless.
    request.locale = path === '/healthz' ? state.config.defaultLocale : headerLocale(state, request)
    done()
  })

  app.addHook('onRequest', (request, _reply, done) => {
    const path = request.url.split('?')[0] ?? ''
    if (OPEN_PATHS.has(path)) { done(); return }
    // Static assets are served outside /api and need no session or account: the shell
    // must load before setup so it can serve the account-creation wizard (spec §6.4).
    if (!path.startsWith('/api/')) { done(); return }
    if (!hasCredential(state.db)) {
      done(setupRequired('api.setupRequired'))
      return
    }
    if (SESSION_EXEMPT.has(path)) { done(); return }
    const token = request.cookies[SESSION_COOKIE]
    const principalId = token === undefined ? null : readSession(state.db, token)
    if (principalId === null) { done(unauthenticated('api.unauthenticated')); return }
    request.principalId = principalId
    done()
  })

  // Refines the header-only guess above with the principal's own saved preference, once the
  // gate has resolved one — the one query this already paid for before task 10.5. The explicit
  // override (task 9.5.2) beats even that: it is the UI naming its own chrome language.
  app.addHook('preHandler', (request, _reply, done) => {
    if (request.principalId !== undefined) {
      const principalLocale = state.db.select({ locale: principal.locale }).from(principal)
        .where(eq(principal.id, request.principalId)).get()?.locale ?? undefined
      request.locale = overrideLocale(request, state.translator.availableLocales())
        ?? principalLocale
        ?? headerLocale(state, request)
    }
    done()
  })
}

/** spec §11. A distinct header, never Accept-Language: a browser always sends that one. */
function overrideLocale(request: FastifyRequest, available: readonly string[]): string | undefined {
  const asked = request.headers['x-mycelo-locale']
  if (typeof asked !== 'string') return undefined
  return available.includes(asked) ? asked : undefined
}

/** Accept-Language ?? default — no query. The final answer for a request with no principal. */
function headerLocale(state: RuntimeState, request: FastifyRequest): string {
  const header = request.headers['accept-language']
  const preferred = typeof header === 'string'
    ? header.split(',')[0]?.split(';')[0]?.trim()
    : undefined
  // A header naming a locale no catalogue provides must not win: the reader would get the
  // fallback with nothing to explain why (the guard phase 5.5 added to setPrincipalLocale).
  if (preferred !== undefined && preferred !== '') {
    try {
      const canonical = canonicalLocale(preferred)
      if (state.translator.availableLocales().includes(canonical)) return canonical
    } catch { /* an unparseable Accept-Language is not an error, it is just not a choice */ }
  }
  return state.config.defaultLocale
}
