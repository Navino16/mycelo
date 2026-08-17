import type { Logger, MyceliumScope } from '@mycelo/septum'
import { createAdmissionChain, createInhibitorContext } from '../admission/chain.js'
import type { AdmissionChain } from '../admission/chain.js'
import { createMembershipCache } from '../admission/membership.js'
import { buildRoutes } from '../germination/registry.js'
import type { Dormant, GerminatedEnzyme, GerminatedHypha, GerminatedInhibitor, GerminatedRhiza, Registry } from '../germination/registry.js'
import { createMyceliumApi } from '../mycelium-rhiza.js'
import { allInhibitorChannels } from '../restrictions/rules.js'
import { createBus, createEnzymeStartContext, sendVia } from '../rhizomorph/bus.js'
import type { Bus } from '../rhizomorph/bus.js'
import type { RuntimeState } from './state.js'

export interface Mycelium {
  registry: Registry
  bus: Bus
  admission: AdmissionChain
}

/** The three refusal callbacks below each sliced this out of `qualified` themselves. */
function shortName(qualified: string): string {
  return qualified.slice(qualified.indexOf('.') + 1)
}

export function germinationBanner(registry: Registry): string {
  const spores = [...registry.hyphae, ...registry.enzymes, ...registry.rhizas, ...registry.inhibitors]
  return `germinated ${String(spores.length)} spores (${spores.map((s) => s.name).join(', ')})`
}

export interface StartMyceliumOptions {
  registry: Registry
  state: RuntimeState
  logger: Logger
}

/**
 * Starts every germinated spore: every hypha connects, then every rhiza and enzyme
 * starts in dependency order, then every hypha listens (design §2.1).
 */
export async function startMycelium(options: StartMyceliumOptions): Promise<Mycelium> {
  const { registry, state, logger } = options
  const { config, db, translator } = state
  const dormant: Dormant[] = [...registry.dormant]

  // Step 1: connect() every hypha. `busBox.current` fills in once the bus exists,
  // before listen() opens the gate in step 3.
  const busBox: { current?: Bus } = {}
  const connectedHyphae: GerminatedHypha[] = []
  for (const hypha of registry.hyphae) {
    try {
      await hypha.instance.connect({
        config: hypha.config,
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
  const hyphaByName = new Map(connectedHyphae.map((h) => [h.name, h]))
  const startedRhizas: GerminatedRhiza[] = []
  const startedEnzymes: GerminatedEnzyme[] = []
  // Declared here, not at step 2.5 where it fills, because mycelium() below reads it
  // live and an enzyme's start() can call that before step 2.5 runs.
  const startedInhibitors: GerminatedInhibitor[] = []
  // Reassigned once step 3 computes `listening`, so listPlugins() never reports a
  // listen()-failed hypha as germinated after the point bootstrap() itself demotes it.
  let reportedHyphae: readonly GerminatedHypha[] = connectedHyphae
  // Reads reportedHyphae/startedRhizas/startedEnzymes/dormant live, so an enzyme
  // starting mid-loop sees exactly what has germinated and started so far.
  const mycelium = (scopes: readonly MyceliumScope[]): object => createMyceliumApi(
    {
      ...registry,
      hyphae: reportedHyphae,
      rhizas: startedRhizas,
      enzymes: startedEnzymes,
      inhibitors: startedInhibitors,
      dormant,
    },
    scopes,
    (target, content) => sendVia(hyphaByName, target.channel, target.conversationId, content),
    db,
    config.sporesDir,
    { defaultRole: config.defaultRole, translator },
  )
  for (const name of registry.order) {
    const rhiza = rhizaByName.get(name)
    if (rhiza !== undefined) {
      try {
        await rhiza.instance.start({
          config: rhiza.config,
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
        config: enzyme.config,
        domain: enzyme.name,
        translator,
        db,
        defaultLocale: config.defaultLocale,
      }))
      startedEnzymes.push(enzyme)
    } catch (e) {
      logger.warn(`enzyme '${enzyme.name}' failed to start and is dormant`, { reason: (e as Error).message })
      dormant.push({ name: enzyme.name, reason: (e as Error).message })
    }
  }

  // Step 2.5: inhibitors start last among the dependency-ordered spores, because
  // ctx.rhiza() may reach a rhiza that must already be running (design §7).
  const membership = createMembershipCache(connectedHyphae)
  const brokenEnforcing: string[] = [...registry.brokenEnforcing]
  for (const inhibitor of registry.inhibitors) {
    const ctx = createInhibitorContext({
      inhibitor, membership, rhizas: startedRhizas, mycelium,
      logger: logger.child({ inhibitor: inhibitor.name }),
      translator, defaultLocale: config.defaultLocale,
    })
    try {
      await inhibitor.instance.start?.(ctx)
      startedInhibitors.push(inhibitor)
    } catch (e) {
      const reason = (e as Error).message
      dormant.push({ name: inhibitor.name, reason })
      if (inhibitor.manifest.enforcing) {
        // Design §7: an enforcing inhibitor that never started refuses everything,
        // rather than leaving the channel it guarded wide open.
        brokenEnforcing.push(inhibitor.name)
        logger.error(`enforcing inhibitor '${inhibitor.name}' failed to start: all traffic is refused`, { reason })
      } else {
        logger.warn(`inhibitor '${inhibitor.name}' failed to start and is dormant`, { reason })
      }
    }
  }

  const admission = createAdmissionChain({
    inhibitors: startedInhibitors,
    brokenEnforcing,
    membership,
    logger,
    channelScopes: () => allInhibitorChannels(db),
    rhiza: (inhibitor) => {
      const ctx = createInhibitorContext({
        inhibitor, membership, rhizas: startedRhizas, mycelium,
        logger: logger.child({ inhibitor: inhibitor.name }),
        translator, defaultLocale: config.defaultLocale,
      })
      // Method-call syntax, not a bare reference: extracting ctx.rhiza would trip
      // @typescript-eslint/unbound-method on the interface's method-shorthand signature.
      return <T>(name: string): T => ctx.rhiza<T>(name)
    },
    translator,
    defaultLocale: config.defaultLocale,
  })

  // A failed start() must not leave the enzyme routable: routes are rebuilt from
  // only the enzymes that started (safe — buildRoutes() already accepted the full
  // set at germination, and removing entries cannot introduce a new collision).
  const routedRegistry: Registry = {
    ...registry,
    hyphae: connectedHyphae,
    rhizas: startedRhizas,
    enzymes: startedEnzymes,
    inhibitors: startedInhibitors,
    brokenEnforcing,
    routes: buildRoutes(startedEnzymes),
  }

  const bus = createBus({
    registry: routedRegistry,
    prefix: config.prefix,
    logger,
    db,
    admission,
    sporesDir: config.sporesDir,
    ...(config.defaultRole === undefined ? {} : { defaultRole: config.defaultRole }),
    translator,
    defaultLocale: config.defaultLocale,
    mycelium,
    onUnrouted: async (message, command, locale) => {
      if (command === null) return
      await sendVia(hyphaByName, message.channel, message.conversationId, {
        text: translator.translate('core', 'command.unknown', locale, { command }),
      })
    },
    onDenied: async (message, qualified, locale) => {
      await sendVia(hyphaByName, message.channel, message.conversationId, {
        text: translator.translate('core', 'command.denied', locale, { command: shortName(qualified) }),
      })
    },
    onUnsupported: async (message, qualified, capability, locale) => {
      await sendVia(hyphaByName, message.channel, message.conversationId, {
        text: translator.translate('core', 'command.unsupported', locale, {
          command: shortName(qualified), capability, channel: message.channel,
        }),
      })
    },
    onOutOfContext: async (message, qualified, where, locale) => {
      await sendVia(hyphaByName, message.channel, message.conversationId, {
        text: translator.translate('core', `context.${where}`, locale, { command: shortName(qualified) }),
      })
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
  reportedHyphae = listening

  return { registry: { ...routedRegistry, hyphae: listening, dormant }, bus, admission }
}
