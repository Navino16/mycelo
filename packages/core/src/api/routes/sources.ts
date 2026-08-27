import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { SporangiumSource } from '@mycelo/septum'
import type { RuntimeState } from '../../boot/state.js'
import { SPORE_NAME } from '../../sporangium/driver.js'
import type { DriverFactory, SporangiumDriver } from '../../sporangium/driver.js'
import { githubDriver } from '../../sporangium/github.js'
import { inoculate } from '../../sporangium/inoculate.js'
import {
  addSource, deleteSource, getSource, installsFromSource, listSources, sourceLocation, sourceToken,
  updateSource,
} from '../../sporangium/sources.js'
import { createLogger } from '../../support/logger.js'
import { describeFault, describeThrown } from '../../support/thrown.js'
import { ApiError, badRequest, conflict, notFound } from '../errors.js'
import { parseBody } from '../parse.js'

// `official` is absent by construction: Zod strips what the schema does not name, and a
// source an operator could mark official would bypass the whole trust model (design §11).
const addSchema = z.object({
  label: z.string().min(1),
  driver: z.literal('github'),
  location: z.string().min(1),
  token: z.string().optional(),
})

const patchSchema = z.object({
  label: z.string().min(1).optional(),
  location: z.string().min(1).optional(),
  token: z.string().optional(),
  enabled: z.boolean().optional(),
})

const inoculateSchema = z.object({
  name: z.string().min(1),
  strain: z.string().min(1).optional(),
})

export function registerSourceRoutes(
  app: FastifyInstance, state: RuntimeState, driverFor?: DriverFactory,
): void {
  const logger = createLogger()

  function requireSource(request: FastifyRequest): SporangiumSource {
    const { id } = request.params as { id: string }
    const source = /^\d+$/.test(id) ? getSource(state.db, Number(id)) : null
    if (source === null) throw notFound('api.sourceNotFound', { id })
    return source
  }

  function driverOf(source: SporangiumSource): SporangiumDriver {
    // design §7: a local root's contents are the installed list, so there is nothing to
    // browse. An empty list would read as "this source offers nothing".
    if (source.driver === 'local') throw notFound('api.sourceLocalBrowse')
    // Deliberately not gated on source.enabled, unlike inoculate: browsing a disabled source
    // is how an operator looks before re-enabling it. It does send the stored token.
    // sourceLocation, not source.location: the DTO's userinfo is redacted (spec §10) and the
    // driver has to send it.
    return driverFor?.(source.id)
      ?? githubDriver(sourceLocation(state.db, source.id) ?? source.location, sourceToken(state.db, source.id))
  }

  /**
   * A local source's label is its absolute path (upsertLocalSource), which spec §10 keeps out
   * of a client-visible message. Only `github` sources are ever named.
   */
  function nameOf(source: SporangiumSource): string {
    return source.driver === 'local' ? 'a local spores directory' : source.label
  }

  async function reachable<T>(source: SporangiumSource, run: () => Promise<T>): Promise<T> {
    try {
      return await run()
    } catch (e) {
      logger.error(`sporangium '${source.label}' could not be read`, { error: describeFault(e) })
      // describeThrown is safe as a detail only while githubDriver is the sole driver: its
      // messages are the core's own and carry no path. A third-party driver would not be.
      throw badRequest('api.sourceUnreachable', { label: nameOf(source) }, describeThrown(e))
    }
  }

  app.get('/api/sources', () => listSources(state.db))

  app.get('/api/sources/:id', (request) => requireSource(request))

  app.post('/api/sources', (request) => addSource(state.db, parseBody(addSchema, request.body)))

  app.patch('/api/sources/:id', (request) => {
    const source = requireSource(request)
    const patch = parseBody(patchSchema, request.body)
    // updateSource is what actually freezes it, for the mycelium door too; this only stops
    // the API answering 200 for a change it did not make (design §11).
    if (source.official && patch.location !== undefined && patch.location !== source.location) {
      throw conflict('api.sourceOfficialLocation')
    }
    return updateSource(state.db, source.id, patch)
  })

  app.delete('/api/sources/:id', (request, reply) => {
    const source = requireSource(request)
    // deleteSource collapses three causes into one boolean; separated here so each refusal
    // names what actually blocks it (design §11).
    if (source.official) throw conflict('api.sourceOfficial', { label: source.label })
    const installed = installsFromSource(state.db, source.id)
    if (installed.length > 0) {
      throw conflict('api.sourceInUse', { label: nameOf(source), spores: installed.join(', ') })
    }
    deleteSource(state.db, source.id)
    return reply.code(204).send()
  })

  app.get('/api/sources/:id/spores', async (request) => {
    const source = requireSource(request)
    const driver = driverOf(source)
    return await reachable(source, () => driver.list())
  })

  app.get('/api/sources/:id/spores/:name', async (request) => {
    const source = requireSource(request)
    const { name } = request.params as { name: string }
    // A name reaches the driver as a URL path segment, so it is validated before it does.
    if (!SPORE_NAME.test(name)) throw notFound('api.sporeNotOffered', { name, label: nameOf(source) })
    const driver = driverOf(source)
    const strains = await reachable(source, () => driver.strains(name))
    const newest = strains[0]
    if (newest === undefined) throw notFound('api.sporeNotOffered', { name, label: nameOf(source) })
    return { strains, detail: await reachable(source, () => driver.detail(name, newest)) }
  })

  app.post('/api/sources/:id/inoculate', async (request) => {
    const source = requireSource(request)
    const body = parseBody(inoculateSchema, request.body)
    let result: Awaited<ReturnType<typeof inoculate>>
    try {
      result = await inoculate({
        db: state.db,
        sporesDirs: state.config.discoveryDirs,
        managedRoot: state.config.managedRoot,
        logger,
        ...(driverFor === undefined ? {} : { driverFor }),
      }, {
        sourceId: source.id,
        name: body.name,
        ...(body.strain === undefined ? {} : { strain: body.strain }),
      })
    } catch (e) {
      // design §9 leaves discover() reachable, and only on the server's own managed root —
      // so 400 would re-prompt an operator who can do nothing. Spec §10 keeps the fault,
      // which carries absolute paths, in the log rather than in the answer.
      logger.error(`inoculating '${body.name}' threw`, { error: describeFault(e) })
      throw new ApiError(500, 'internal', 'api.inoculateFailed', { name: body.name })
    }
    if (!result.ok) {
      throw badRequest('api.inoculateRefused', { name: body.name, label: nameOf(source) }, result.reason)
    }
    // The warnings are inoculate's, never composed here: a UI that forgets to render a flag
    // must still receive the sentence (design §11).
    return {
      name: result.name, strain: result.strain, warnings: result.warnings, restartRequired: result.restartRequired,
    }
  })
}
