import { loadBootstrap } from './config.js'
import { germinate } from './germination/germinate.js'
import type { Dormant, GerminatedHypha, Registry } from './germination/registry.js'
import { createBus } from './rhizomorph/bus.js'
import type { Bus } from './rhizomorph/bus.js'
import { createLogger } from './support/logger.js'

export interface Mycelium {
  registry: Registry
  bus: Bus
}

/**
 * Germinates every spore, wires the bus between them, and starts every hypha. This is
 * the whole runtime's wiring in one place, so a test can exercise the same code path
 * `index.ts` runs — previously nothing imported `src/index.ts` and its own milestone
 * test rebuilt the wiring by hand, so the tested and the shipped wiring could and did
 * diverge.
 */
export async function bootstrap(configFile: string): Promise<Mycelium> {
  const logger = createLogger()
  const config = loadBootstrap(configFile)
  const registry = await germinate(config.sporesDir, logger)

  const bus = createBus({
    registry,
    prefix: config.prefix,
    logger,
    onUnrouted: async (message, command) => {
      if (command === null) return
      const hypha = registry.hyphae.find((h) => h.name === message.channel)
      await hypha?.instance.send(message.conversationId, { text: `unknown command '${command}'` })
    },
  })

  // A hypha whose start() throws is contained the same way a germination failure is
  // (spec §8): it goes dormant and the others still start. Previously this loop had no
  // try/catch, so one bad hypha killed the process before any other hypha started.
  const started: GerminatedHypha[] = []
  const dormant: Dormant[] = [...registry.dormant]
  for (const hypha of registry.hyphae) {
    try {
      await hypha.instance.start({
        config: {},
        logger: logger.child({ hypha: hypha.name }),
        emit: (message) => {
          // Fire-and-forget by necessity — a hypha cannot await its own dispatch — but
          // never bare: an unhandled rejection from deliver() used to be process-fatal.
          bus.deliver(hypha.name, message).catch((e: unknown) => {
            logger.error(`unhandled failure delivering a message from '${hypha.name}'`, {
              error: (e as Error).message,
            })
          })
        },
      })
      started.push(hypha)
    } catch (e) {
      logger.warn(`hypha '${hypha.name}' failed to start and is dormant`, { reason: (e as Error).message })
      dormant.push({ name: hypha.name, reason: (e as Error).message })
    }
  }

  return { registry: { ...registry, hyphae: started, dormant }, bus }
}
