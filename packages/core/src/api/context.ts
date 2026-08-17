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
  // both thrown from that later onRequest hook — always have a locale to render with. Derives
  // its own principal from the cookie rather than depending on the gate's `request.principalId`.
  app.addHook('onRequest', (request, _reply, done) => {
    const path = request.url.split('?')[0] ?? ''
    // §17.5: the container probe stays dataless — resolveApiLocale would otherwise query.
    request.locale = path === '/healthz' ? state.config.defaultLocale : resolveApiLocale(state, request)
    done()
  })

  app.addHook('onRequest', (request, _reply, done) => {
    const path = request.url.split('?')[0] ?? ''
    if (OPEN_PATHS.has(path)) { done(); return }
    if (!hasCredential(state.db)) {
      done(setupRequired('api.setupRequired'))
      return
    }
    // Static assets are served outside /api and need no session: the SPA shell itself
    // must load so it can show the login form.
    if (!path.startsWith('/api/')) { done(); return }
    if (SESSION_EXEMPT.has(path)) { done(); return }
    const token = request.cookies[SESSION_COOKIE]
    const principalId = token === undefined ? null : readSession(state.db, token)
    if (principalId === null) { done(unauthenticated('api.unauthenticated')); return }
    request.principalId = principalId
    done()
  })
}

/**
 * principal ?? Accept-Language ?? default. Written here rather than through
 * i18n/locale.ts's resolveLocale, whose signature is
 * `(db, channel, conversationId, principalId, fallback)` — a chat conversation's cascade,
 * which an HTTP request has no rung for. Widening it would touch four other call sites.
 */
function resolveApiLocale(state: RuntimeState, request: FastifyRequest): string {
  const token = request.cookies[SESSION_COOKIE]
  const principalId = token === undefined ? null : readSession(state.db, token)
  const chosen = principalId === null
    ? null
    : state.db.select({ locale: principal.locale }).from(principal)
        .where(eq(principal.id, principalId)).get()?.locale ?? null
  if (chosen !== null) return chosen
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
