import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import type { UiConfig } from '../config.js'

export interface ServerOptions {
  trustProxy: boolean
}

export function createServer(options: ServerOptions): FastifyInstance {
  const app = Fastify({ logger: false, trustProxy: options.trustProxy })
  // Dataless and unauthenticated: it is the container probe (spec §17.5).
  app.get('/healthz', () => ({ ok: true }))
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
