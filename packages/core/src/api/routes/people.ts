import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Principal } from '@mycelo/septum'
import type { RuntimeState } from '../../boot/state.js'
import { isRefusal } from '../../authorization/refusal.js'
import { assignRole, revokeRole } from '../../authorization/roles.js'
import {
  isReviewed, loadPrincipal, markReviewed, requirePrincipal, searchPrincipals, setDisplayName,
} from '../../identity/people.js'
import type { Db } from '../../persistence/db.js'
import { notFound } from '../errors.js'
import { parseBody, parseQuery } from '../parse.js'

/** Additive to septum's `Principal`, HTTP-only: the UI needs to know whether a person was reviewed. */
interface PersonDto extends Principal { reviewed: boolean }

function toDto(db: Db, person: Principal): PersonDto {
  return { ...person, reviewed: isReviewed(db, person.id) }
}

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

/** assignRole/revokeRole check the role before the principal, so a bad role wins the race. */
function roleAssignmentError(e: unknown, id: string, roleName: string): never {
  if (isRefusal(e, 'role-unknown')) throw notFound('api.roleNotFound', { role: roleName })
  if (isRefusal(e, 'principal-unknown')) throw notFound('api.personNotFound', { id })
  throw e
}

export function registerPeopleRoutes(app: FastifyInstance, state: RuntimeState): void {
  app.get('/api/people', (request) => {
    const q = parseQuery(peopleQuerySchema, request.query)
    // Clamped, and the response says which perPage was applied: silently serving fewer
    // rows than asked reads as "that is all there is" (spec §8).
    const perPage = Math.min(q.perPage, PER_PAGE_CAP)
    const result = searchPrincipals(state.db, {
      page: q.page,
      perPage,
      ...(q.q === undefined ? {} : { search: q.q }),
      ...(q.reviewed === undefined ? {} : { reviewed: q.reviewed === 'true' }),
    })
    return { ...result, items: result.items.map((p) => toDto(state.db, p)) }
  })

  app.get('/api/people/:id', (request) => {
    const { id } = request.params as { id: string }
    const person = loadPrincipal(state.db, id)
    if (person === null) throw notFound('api.personNotFound', { id })
    return toDto(state.db, person)
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
      if (isRefusal(e, 'principal-unknown')) throw notFound('api.personNotFound', { id })
      throw e
    }
    const updated = loadPrincipal(state.db, id)
    return updated === null ? null : toDto(state.db, updated)
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
