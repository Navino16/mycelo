import type { FastifyInstance } from 'fastify'
import type { RuntimeState } from '../../boot/state.js'

/**
 * The operator-visible slice of mycelo.yaml. No filesystem path: spec §10 forbids an absolute
 * path in anything a client sees, and no screen needs one — provenance travels on PluginInfo.
 */
export interface ConfigDto {
  /** What a command is typed with, so a help surface can show the real syntax. */
  prefix: string
  defaultLocale: string
  /** Absent when mycelo.yaml sets none, in which case an unknown sender gets no role at all. */
  defaultRole?: string
}

export function registerConfigRoutes(app: FastifyInstance, state: RuntimeState): void {
  app.get('/api/config', (): ConfigDto => ({
    prefix: state.config.prefix,
    defaultLocale: state.config.defaultLocale,
    ...(state.config.defaultRole === undefined ? {} : { defaultRole: state.config.defaultRole }),
  }))
}
