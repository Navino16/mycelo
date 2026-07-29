import type { InhibitorContext } from './context.js'
import type { IncomingMessage } from './message.js'
import type { SporeModule } from './spore.js'

export type Verdict = { allow: true } | { allow: false; reason: string }

export interface Inhibitor<TConfig = unknown> {
  inspect(message: IncomingMessage, ctx: InhibitorContext<TConfig>): Promise<Verdict>
  start?(ctx: InhibitorContext<TConfig>): Promise<void>
  stop?(): Promise<void>
}

export type InhibitorModule<TConfig = unknown> = SporeModule<Inhibitor<TConfig>, TConfig>
