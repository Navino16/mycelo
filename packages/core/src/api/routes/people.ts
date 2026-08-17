import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { RuntimeState } from '../../boot/state.js'
import { assignRole, revokeRole } from '../../authorization/roles.js'
import { loadPrincipal, markReviewed, requirePrincipal, searchPrincipals, setDisplayName } from '../../identity/people.js'
import { notFound } from '../errors.js'
import { parseBody, parseQuery } from '../parse.js'

const PER_PAGE_CAP = 200

const peopleQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).default(50),
  q: z.string().optional(),
  reviewed: z.enum(['true', 'false']).optional(),
})

const patchSchema = z.object({
  displayName: z.string().min(1).optional(),
  // No inverse: markReviewed cannot un-review, so accepting `false` would take a value
  // the store cannot honour.
  reviewed: z.literal(true).optional(),
})

const roleBodySchema = z.object({ role: z.string().min(1) })

function isPrincipalMissing(e: unknown, id: string): boolean {
  return e instanceof Error && e.message === `principal '${id}' does not exist`
}

/** assignRole/revokeRole check the role before the principal, so a bad role wins the race. */
function roleAssignmentError(e: unknown, id: string, roleName: string): never {
  if (e instanceof Error && e.message === `role '${roleName}' does not exist`) {
    throw notFound('api.roleNotFound', { role: roleName })
  }
  if (isPrincipalMissing(e, id)) throw notFound('api.personNotFound', { id })
  throw e
}

export function registerPeopleRoutes(app: FastifyInstance, state: RuntimeState): void {
  app.get('/api/people', (request) => {
    const q = parseQuery(peopleQuerySchema, request.query)
    // Clamped, and the response says which perPage was applied: silently serving fewer
    // rows than asked reads as "that is all there is" (spec §8).
    const perPage = Math.min(q.perPage, PER_PAGE_CAP)
    return searchPrincipals(state.db, {
      page: q.page,
      perPage,
      ...(q.q === undefined ? {} : { search: q.q }),
      ...(q.reviewed === undefined ? {} : { reviewed: q.reviewed === 'true' }),
    })
  })

  app.get('/api/people/:id', (request) => {
    const { id } = request.params as { id: string }
    const person = loadPrincipal(state.db, id)
    if (person === null) throw notFound('api.personNotFound', { id })
    return person
  })

  app.patch('/api/people/:id', (request) => {
    const { id } = request.params as { id: string }
    const body = parseBody(patchSchema, request.body)
    try {
      // Checked up front, not only implied by the two calls below: an empty body would
      // otherwise skip both and answer 200 with null for an id that does not exist.
      requirePrincipal(state.db, id)
      if (body.displayName !== undefined) setDisplayName(state.db, id, body.displayName)
      if (body.reviewed === true) markReviewed(state.db, id)
    } catch (e) {
      if (isPrincipalMissing(e, id)) throw notFound('api.personNotFound', { id })
      throw e
    }
    return loadPrincipal(state.db, id)
  })

  app.post('/api/people/:id/roles', (request) => {
    const { id } = request.params as { id: string }
    const body = parseBody(roleBodySchema, request.body)
    try { assignRole(state.db, id, body.role) } catch (e) { roleAssignmentError(e, id, body.role) }
    return { ok: true }
  })

  app.delete('/api/people/:id/roles/:role', (request) => {
    const { id, role } = request.params as { id: string, role: string }
    try { revokeRole(state.db, id, role) } catch (e) { roleAssignmentError(e, id, role) }
    return { ok: true }
  })
}
