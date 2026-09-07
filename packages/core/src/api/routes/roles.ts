import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { RuntimeState } from '../../boot/state.js'
import { createRole, deleteRole, listRoles, setRoleCommands } from '../../authorization/roles.js'
import { isRefusal } from '../../authorization/refusal.js'
import { badRequestRefusal, conflictRefusal, notFoundRefusal } from '../errors.js'
import { parseBody } from '../parse.js'

const createSchema = z.object({
  name: z.string().min(1),
  patterns: z.array(z.string().min(1)).default([]),
})

const commandsSchema = z.object({ patterns: z.array(z.string().min(1)) })

// role-name-empty cannot reach here: createSchema's name already refuses an empty string
// before the store ever sees it. Mapped anyway so a future relaxation of the schema does
// not fall through to an unmapped fault.
function createRoleError(e: unknown): never {
  if (isRefusal(e, 'role-name-empty')) throw badRequestRefusal(e.code)
  if (isRefusal(e, 'role-exists')) throw conflictRefusal(e.code, e.params)
  if (isRefusal(e, 'pattern-duplicate')) throw badRequestRefusal(e.code, e.params)
  throw e
}

function setCommandsError(e: unknown): never {
  if (isRefusal(e, 'role-unknown')) throw notFoundRefusal(e.code, e.params)
  if (isRefusal(e, 'role-builtin')) throw badRequestRefusal(e.code, e.params)
  if (isRefusal(e, 'pattern-duplicate')) throw badRequestRefusal(e.code, e.params)
  throw e
}

function deleteRoleError(e: unknown): never {
  if (isRefusal(e, 'role-unknown')) throw notFoundRefusal(e.code, e.params)
  if (isRefusal(e, 'role-builtin')) throw badRequestRefusal(e.code, e.params)
  if (isRefusal(e, 'role-is-default')) throw badRequestRefusal(e.code, e.params)
  throw e
}

export function registerRoleRoutes(app: FastifyInstance, state: RuntimeState): void {
  app.get('/api/roles', () => listRoles(state.db))

  app.get('/api/roles/:name', (request) => {
    const { name } = request.params as { name: string }
    const found = listRoles(state.db).find((r) => r.name === name)
    if (found === undefined) throw notFoundRefusal('role-unknown', { role: name })
    return found
  })

  app.post('/api/roles', (request) => {
    const body = parseBody(createSchema, request.body)
    try { createRole(state.db, body.name, body.patterns) } catch (e) { createRoleError(e) }
    return { ok: true }
  })

  app.put('/api/roles/:name/commands', (request) => {
    const { name } = request.params as { name: string }
    const body = parseBody(commandsSchema, request.body)
    try { setRoleCommands(state.db, name, body.patterns) } catch (e) { setCommandsError(e) }
    return { ok: true }
  })

  app.delete('/api/roles/:name', (request) => {
    const { name } = request.params as { name: string }
    // The guard the writer already has, given the argument the reader must not forget
    // (design §5.4): state.config.defaultRole, not undefined, and not omitted.
    try { deleteRole(state.db, name, state.config.defaultRole) } catch (e) { deleteRoleError(e) }
    return { ok: true }
  })
}
