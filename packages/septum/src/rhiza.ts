import type { HealthStatus, RhizaContext } from './context.js'
import type { SporeModule } from './spore.js'

export interface Rhiza<TConfig = unknown, TApi = unknown> {
  start(ctx: RhizaContext<TConfig>): Promise<void>
  stop(): Promise<void>
  health(): Promise<HealthStatus>
  /** What enzymes reach through ctx.rhiza(). */
  readonly api: TApi
}

export type RhizaModule<TConfig = unknown, TApi = unknown> = SporeModule<
  Rhiza<TConfig, TApi>,
  TConfig
>
