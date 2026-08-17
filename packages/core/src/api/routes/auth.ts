import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { RuntimeState } from '../../boot/state.js'
import { assignRole } from '../../authorization/roles.js'
import { ensureOwnerRole } from '../../identity/bootstrap.js'
import { loadPrincipal } from '../../identity/people.js'
import { principal as principalTable, channelIdentity, uiCredential } from '../../persistence/schema.js'
import { and, eq } from 'drizzle-orm'
import {
  changePassword, createCredential, hasCredential, verifyCredential,
} from '../credentials.js'
import { SESSION_COOKIE, closeSession, closeSessionsFor, openSession } from '../sessions.js'
import { badRequest, conflict, notFound, unauthenticated } from '../errors.js'
import { parseBody, requirePrincipalId } from '../parse.js'
import { setSessionCookie } from '../cookies.js'

const setupSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(8),
})

const loginSchema = z.object({ username: z.string().min(1), password: z.string().min(1) })
const passwordSchema = z.object({ current: z.string().min(1), next: z.string().min(8) })

/**
 * §5.4: a UI credential is another identity of the same principal, so it binds to the
 * configured owner when there is one and roles are consistent with the channels for free.
 */
function ownerPrincipal(state: RuntimeState): string {
  const configured = state.config.owner
  if (configured !== undefined) {
    const row = state.db
      .select({ principalId: channelIdentity.principalId })
      .from(channelIdentity)
      .where(and(
        eq(channelIdentity.channel, configured.channel),
        eq(channelIdentity.externalId, configured.userId),
      ))
      .get()
    // bootstrapIdentity created it in phase 1, so undefined here is a core bug.
    if (row === undefined) throw new Error('the configured owner principal is missing')
    return row.principalId
  }
  const id = crypto.randomUUID()
  state.db.insert(principalTable).values({ id, createdAt: new Date() }).run()
  // bootstrapIdentity deliberately does nothing when mycelo.yaml has no `owner:` block,
  // so the 'owner' role does not exist yet — the wizard is the only other place that
  // must create it before it can be assigned.
  ensureOwnerRole(state.db)
  assignRole(state.db, id, 'owner')
  return id
}

export function registerAuthRoutes(app: FastifyInstance, state: RuntimeState): void {
  app.get('/api/setup', () => ({ required: !hasCredential(state.db) }))

  app.post('/api/setup', async (request, reply) => {
    if (hasCredential(state.db)) throw conflict('a UI account already exists')
    const body = parseBody(setupSchema, request.body)
    const principalId = ownerPrincipal(state)
    try {
      await createCredential(state.db, principalId, body.username, body.password)
    } catch (e) {
      // The primary key is what makes two simultaneous setups safe; the loser lands here.
      throw conflict((e as Error).message)
    }
    setSessionCookie(reply, openSession(state.db, principalId), request.protocol === 'https')
    return { ok: true }
  })

  app.post('/api/login', {
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const body = parseBody(loginSchema, request.body)
    const principalId = await verifyCredential(state.db, body.username, body.password)
    if (principalId === null) throw unauthenticated('wrong username or password')
    setSessionCookie(reply, openSession(state.db, principalId), request.protocol === 'https')
    return { ok: true }
  })

  app.post('/api/logout', (request, reply) => {
    const token = request.cookies[SESSION_COOKIE]
    if (token !== undefined) closeSession(state.db, token)
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    return { ok: true }
  })

  app.get('/api/me', (request) => {
    const id = requirePrincipalId(request.principalId)
    const person = loadPrincipal(state.db, id)
    if (person === null) throw notFound('the session principal no longer exists')
    const credential = state.db.select({ username: uiCredential.username }).from(uiCredential)
      .where(eq(uiCredential.principalId, id)).get()
    return { ...person, username: credential?.username ?? null, locale: request.locale }
  })

  app.put('/api/me/password', async (request) => {
    const id = requirePrincipalId(request.principalId)
    const body = parseBody(passwordSchema, request.body)
    try {
      await changePassword(state.db, id, body.current, body.next)
    } catch (e) {
      throw badRequest((e as Error).message)
    }
    // Ruling from task 9's review: a password change must not leave a stolen cookie live
    // elsewhere, but must not log the caller themselves out of their own change.
    closeSessionsFor(state.db, id, request.cookies[SESSION_COOKIE])
    return { ok: true }
  })
}
