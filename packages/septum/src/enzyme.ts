import type { EnzymeContext, EnzymeStartContext, Invocation } from './context.js'
import type { SporeModule } from './spore.js'

/**
 * Note there is no `commands` member: the manifest is the single source of truth,
 * because the core must list commands for authorization and for the UI before any
 * plugin code runs.
 */
export interface Enzyme<TConfig = unknown> {
  handle(invocation: Invocation, ctx: EnzymeContext<TConfig>): Promise<void>
  /**
   * Optional. For subscribing to rhiza events or scheduling proactive pushes.
   * Receives the restricted context: no message has arrived yet.
   */
  start?(ctx: EnzymeStartContext<TConfig>): Promise<void>
  stop?(): Promise<void>
}

export type EnzymeModule<TConfig = unknown> = SporeModule<Enzyme<TConfig>, TConfig>
