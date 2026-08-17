import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { RuntimeState } from '../../boot/state.js'
import { assignRole } from '../../authorization/roles.js'
import { ensureOwnerRole } from '../../identity/bootstrap.js'
import { loadPrincipal } from '../../identity/people.js'
import { principal as principalTable, channelIdentity, uiCredential } from '../../persistence/schema.js'
import { and, eq } from 'drizzle-orm'
import {
  changePassword, hasCredential, insertCredential, verifyCredential,
} from '../credentials.js'
import { SESSION_COOKIE, closeSession, closeSessionsFor, openSession } from '../sessions.js'
import { badRequest, conflict, notFound, unauthenticated } from '../errors.js'
import { parseBody, requirePrincipalId } from '../parse.js'
import { setSessionCookie } from '../cookies.js'

// .trim() so a whitespace-only username is a 400 (§9) at the schema, never reaching the
// store's own check — which would otherwise surface as a 409 (review finding, Important 3).
const setupSchema = z.object({
  username: z.string().trim().min(1),
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
    const body = parseBody(setupSchema, request.body)
    // Fast-fail before hashing: cheap, and avoids paying for argon2 on the common case of a
    // wizard that already ran. It is not the guard that makes this safe — see below.
    if (hasCredential(state.db)) throw conflict('a UI account already exists')
    const passwordHash = await Bun.password.hash(body.password)
    let principalId: string
    try {
      // Critical 1 (review): the actual guard. `await Bun.password.hash` above is the gap two
      // concurrent setups raced through — the check above and the store's own check both ran
      // before either request's hash resolved, so neither saw the other's row. Everything from
      // here down is synchronous (bun:sqlite's `transaction()` callback cannot await), which
      // under Bun's single-threaded event loop means no other request's code can interleave
      // between this re-check and the insert. The transaction also rolls back the principal
      // `ownerPrincipal` may have just created if the insert below still fails (Important 2).
      principalId = state.db.transaction(() => {
        if (hasCredential(state.db)) throw new Error('a UI account already exists')
        const id = ownerPrincipal(state)
        insertCredential(state.db, id, body.username, passwordHash)
        return id
      })
    } catch (e) {
      // Reached only for a genuine duplicate now: the schema above rejects a bad username
      // before this point, so nothing validation-shaped lands here to be mislabelled.
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
      // Narrowed (review, Important 3): only a wrong current password is this caller's
      // mistake. A missing account or a store fault is not, and must not be told as one.
      if (e instanceof Error && e.message === 'the current password is wrong') throw badRequest(e.message)
      throw e
    }
    // Ruling from task 9's review: a password change must not leave a stolen cookie live
    // elsewhere, but must not log the caller themselves out of their own change.
    closeSessionsFor(state.db, id, request.cookies[SESSION_COOKIE])
    return { ok: true }
  })
}
