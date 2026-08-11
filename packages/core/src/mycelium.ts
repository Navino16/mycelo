import { loadBootstrap } from './config.js'
import { germinate } from './germination/germinate.js'
import { buildRoutes } from './germination/registry.js'
import type { Dormant, GerminatedEnzyme, GerminatedHypha, Registry } from './germination/registry.js'
import { createBus, createEnzymeStartContext } from './rhizomorph/bus.js'
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
  const dormant: Dormant[] = [...registry.dormant]

  // septum's own conformance kit both requires start()/stop() as a pair and calls
  // start() before handle() — but nothing in the runtime called it until now, so an
  // enzyme that memoises state in start() reached its first command with that state
  // never set. Runs before any hypha starts emitting, so nothing can reach handle()
  // while an enzyme's start() is still in flight. Symmetric stop() — for either kind
  // — and signal handling are deliberately deferred to phase 6 (supervision): this
  // file only ever starts things.
  const startedEnzymes: GerminatedEnzyme[] = []
  for (const enzyme of registry.enzymes) {
    // A text-only enzyme has no instance to start (phase 2).
    if (enzyme.instance === null || enzyme.instance.start === undefined) {
      startedEnzymes.push(enzyme)
      continue
    }
    try {
      await enzyme.instance.start(createEnzymeStartContext(registry.hyphae, logger.child({ enzyme: enzyme.name })))
      startedEnzymes.push(enzyme)
    } catch (e) {
      logger.warn(`enzyme '${enzyme.name}' failed to start and is dormant`, { reason: (e as Error).message })
      dormant.push({ name: enzyme.name, reason: (e as Error).message })
    }
  }
  // A failed start() must not leave the enzyme routable: routes are rebuilt from
  // only the enzymes that started (safe — buildRoutes() already accepted the full
  // set at germination, and removing entries cannot introduce a new collision).
  const routedRegistry: Registry = { ...registry, enzymes: startedEnzymes, routes: buildRoutes(startedEnzymes) }

  const bus = createBus({
    registry: routedRegistry,
    prefix: config.prefix,
    logger,
    onUnrouted: async (message, command) => {
      if (command === null) return
      const hypha = routedRegistry.hyphae.find((h) => h.name === message.channel)
      await hypha?.instance.send(message.conversationId, { text: `unknown command '${command}'` })
    },
  })

  // A hypha whose start() throws is contained the same way a germination failure is
  // (spec §8): it goes dormant and the others still start. Previously this loop had no
  // try/catch, so one bad hypha killed the process before any other hypha started.
  const started: GerminatedHypha[] = []
  for (const hypha of routedRegistry.hyphae) {
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

  return { registry: { ...routedRegistry, hyphae: started, dormant }, bus }
}
