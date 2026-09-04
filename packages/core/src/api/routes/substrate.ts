import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { FastifyInstance } from 'fastify'
import type { RuntimeState } from '../../boot/state.js'

/** The process, as opposed to /api/config's slice of mycelo.yaml (inventory §3 rows 1 and 2). */
export interface SubstrateDto {
  version: string
  startedAt: string
  uptimeSeconds: number
}

// Same depth from src/api/routes/ and from dist/api/routes/, so one URL serves both the
// `bun start` path and the built `main`.
const PACKAGE_JSON = fileURLToPath(new URL('../../../package.json', import.meta.url))

function coreVersion(): string {
  const parsed: unknown = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'))
  const version = (parsed as { version?: unknown }).version
  return typeof version === 'string' ? version : '0.0.0'
}

export function registerSubstrateRoutes(app: FastifyInstance, state: RuntimeState): void {
  const version = coreVersion()
  app.get('/api/substrate', (): SubstrateDto => ({
    version,
    startedAt: state.startedAt.toISOString(),
    uptimeSeconds: Math.floor((Date.now() - state.startedAt.getTime()) / 1000),
  }))
}
