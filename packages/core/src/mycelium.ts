import { loadBootstrap } from './config.js'
import { germinate } from './germination/germinate.js'
import { buildRoutes } from './germination/registry.js'
import type { Dormant, GerminatedEnzyme, GerminatedHypha, GerminatedRhiza, Registry } from './germination/registry.js'
import { createBus, createEnzymeStartContext } from './rhizomorph/bus.js'
import type { Bus } from './rhizomorph/bus.js'
import { createLogger } from './support/logger.js'

export interface Mycelium {
  registry: Registry
  bus: Bus
}

// Placeholder until task 6 builds the real mycelium-as-rhiza API from the registry.
const mycelium = (): object => ({})

/**
 * Germinates every spore, then starts it: every hypha connects, then every rhiza and
 * enzyme starts in dependency order, then every hypha listens (design §2.1).
 */
export async function bootstrap(configFile: string): Promise<Mycelium> {
  const logger = createLogger()
  const config = loadBootstrap(configFile)
  const registry = await germinate(config.sporesDir, logger)
  const dormant: Dormant[] = [...registry.dormant]

  // Step 1: connect() every hypha. `busBox.current` fills in once the bus exists,
  // before listen() opens the gate in step 3.
  const busBox: { current?: Bus } = {}
  const connectedHyphae: GerminatedHypha[] = []
  for (const hypha of registry.hyphae) {
    try {
      await hypha.instance.connect({
        config: {},
        logger: logger.child({ hypha: hypha.name }),
        emit: (message) => {
          if (busBox.current === undefined) {
            logger.warn(`hypha '${hypha.name}' emitted before the bus was ready; message dropped`)
            return
          }
          // Fire-and-forget by necessity — a hypha cannot await its own dispatch — but
          // never bare: an unhandled rejection from deliver() used to be process-fatal.
          busBox.current.deliver(hypha.name, message).catch((e: unknown) => {
            logger.error(`unhandled failure delivering a message from '${hypha.name}'`, {
              error: (e as Error).message,
            })
          })
        },
      })
      connectedHyphae.push(hypha)
    } catch (e) {
      logger.warn(`hypha '${hypha.name}' failed to connect and is dormant`, { reason: (e as Error).message })
      dormant.push({ name: hypha.name, reason: (e as Error).message })
    }
  }

  // Step 2: walk registry.order once, dependency-first (design §2.1). A start()
  // failure marks that one spore dormant (spec §8) without skipping the rest.
  const rhizaByName = new Map(registry.rhizas.map((r) => [r.name, r]))
  const enzymeByName = new Map(registry.enzymes.map((e) => [e.name, e]))
  const startedRhizas: GerminatedRhiza[] = []
  const startedEnzymes: GerminatedEnzyme[] = []
  for (const name of registry.order) {
    const rhiza = rhizaByName.get(name)
    if (rhiza !== undefined) {
      try {
        await rhiza.instance.start({
          config: {},
          logger: logger.child({ rhiza: rhiza.name }),
          // Rhiza domain events have no subscriber yet: ctx.on() is not scheduled (design §12).
          emit: () => {},
        })
        startedRhizas.push(rhiza)
      } catch (e) {
        logger.warn(`rhiza '${rhiza.name}' failed to start and is dormant`, { reason: (e as Error).message })
        dormant.push({ name: rhiza.name, reason: (e as Error).message })
      }
      continue
    }
    const enzyme = enzymeByName.get(name)
    if (enzyme === undefined) {
      throw new Error(`unreachable: '${name}' in registry.order is neither a rhiza nor an enzyme`)
    }
    // A text-only enzyme has no instance to start (phase 2).
    if (enzyme.instance === null || enzyme.instance.start === undefined) {
      startedEnzymes.push(enzyme)
      continue
    }
    try {
      await enzyme.instance.start(createEnzymeStartContext({
        hyphae: connectedHyphae,
        rhizas: startedRhizas,
        logger: logger.child({ enzyme: enzyme.name }),
        access: { resolved: enzyme.resolved, scopes: enzyme.scopes },
        mycelium,
      }))
      startedEnzymes.push(enzyme)
    } catch (e) {
      logger.warn(`enzyme '${enzyme.name}' failed to start and is dormant`, { reason: (e as Error).message })
      dormant.push({ name: enzyme.name, reason: (e as Error).message })
    }
  }

  // A failed start() must not leave the enzyme routable: routes are rebuilt from
  // only the enzymes that started (safe — buildRoutes() already accepted the full
  // set at germination, and removing entries cannot introduce a new collision).
  const routedRegistry: Registry = {
    ...registry,
    hyphae: connectedHyphae,
    rhizas: startedRhizas,
    enzymes: startedEnzymes,
    routes: buildRoutes(startedEnzymes),
  }

  const bus = createBus({
    registry: routedRegistry,
    prefix: config.prefix,
    logger,
    mycelium,
    onUnrouted: async (message, command) => {
      if (command === null) return
      const hypha = routedRegistry.hyphae.find((h) => h.name === message.channel)
      await hypha?.instance.send(message.conversationId, { text: `unknown command '${command}'` })
    },
  })
  busBox.current = bus

  // Step 3: open the gate. A hypha whose listen() throws is dormant too (spec §8):
  // it stays reachable for outbound push, but nothing inbound will ever arrive.
  const listening: GerminatedHypha[] = []
  for (const hypha of connectedHyphae) {
    try {
      hypha.instance.listen()
      listening.push(hypha)
    } catch (e) {
      logger.warn(`hypha '${hypha.name}' failed to listen and is dormant`, { reason: (e as Error).message })
      dormant.push({ name: hypha.name, reason: (e as Error).message })
    }
  }

  return { registry: { ...routedRegistry, hyphae: listening, dormant }, bus }
}
