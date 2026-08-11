import type {
  Capabilities,
  ChannelCapability,
  EnzymeContext,
  EnzymeStartContext,
  IncomingMessage,
  Invocation,
  Logger,
  OutgoingContent,
  Principal,
} from '@mycelo/septum'
import type { GerminatedHypha, Registry } from '../germination/registry.js'
import { bindArgs, parseCommand } from './parse.js'
import { normalize } from './normalize.js'

/** Reached only by a plugin using a facility this phase does not provide yet. */
function notYet(what: string, phase: string): never {
  throw new Error(`${what} is not available yet: it arrives in ${phase}`)
}

function capabilitiesOf(hypha: GerminatedHypha | undefined): Capabilities {
  const declared: readonly ChannelCapability[] = hypha?.manifest.capabilities ?? []
  return {
    has: (capability) => declared.includes(capability),
    list: () => declared,
  }
}

/**
 * The message-independent slice of EnzymeContext — push, capabilitiesOf, rhiza, has,
 * on — built once here so mycelium.ts's Enzyme.start() call (before any message
 * exists) and createBus()'s per-message context below share one implementation of
 * the phase-3 "not yet" wiring instead of two.
 */
export function createEnzymeStartContext(hyphae: readonly GerminatedHypha[], logger: Logger): EnzymeStartContext {
  const hyphaByName = new Map(hyphae.map((h) => [h.name, h]))

  async function send(channel: string, conversationId: string, out: OutgoingContent): Promise<void> {
    const hypha = hyphaByName.get(channel)
    if (hypha === undefined) throw new Error(`no hypha named '${channel}'`)
    // The published contract (septum's OutgoingContent) promises this is enforced by
    // the core. It previously was not: ctx.reply({}) reached the hypha untouched.
    if (out.text === undefined && out.attachments === undefined && out.reactTo === undefined) {
      throw new Error('OutgoingContent must set at least one of text, attachments, or reactTo')
    }
    await hypha.instance.send(conversationId, out)
  }

  return {
    // Plugin settings live in the database from phase 5; nothing supplies them yet.
    config: {},
    logger,
    push: async (target, content) => { await send(target.channel, target.conversationId, content) },
    capabilitiesOf: (target) => capabilitiesOf(hyphaByName.get(target.channel)),
    rhiza: () => notYet('ctx.rhiza()', 'phase 3 (anastomoses)'),
    has: () => false,
    on: () => notYet('ctx.on()', 'phase 3 (anastomoses)'),
  }
}

export interface Bus {
  deliver(channel: string, raw: IncomingMessage): Promise<void>
}

export interface BusOptions {
  registry: Registry
  prefix: string
  logger: Logger
  /** Called when text carries no command, or names one nothing declares. */
  onUnrouted?: (message: IncomingMessage, command: string | null) => Promise<void>
}

export function createBus({ registry, prefix, logger, onUnrouted }: BusOptions): Bus {
  const hyphaByName = new Map(registry.hyphae.map((h) => [h.name, h]))
  const startContext = createEnzymeStartContext(registry.hyphae, logger)
  const send = (channel: string, conversationId: string, out: OutgoingContent): Promise<void> =>
    startContext.push({ channel, conversationId }, out)

  function contextFor(message: IncomingMessage): EnzymeContext {
    const origin = hyphaByName.get(message.channel)
    return {
      ...startContext,
      logger: logger.child({ channel: message.channel }),
      reply: async (content) => { await send(message.channel, message.conversationId, content) },
      capabilities: capabilitiesOf(origin),
      get principal(): Principal { return notYet('ctx.principal', 'phase 4 (identity)') },
    }
  }

  return {
    async deliver(channel, raw) {
      // Everything below can reject: a malformed message, onUnrouted, the handler, even
      // the recovery send. None of it may escape — deliver() is invoked as fire-and-forget
      // (bus.deliver(...).catch(...) at the call site), so an uncaught rejection here was
      // observed to become a process-fatal unhandled rejection, not merely a lost message.
      try {
        const message = normalize(channel, raw)
        const parsed = parseCommand(message.text, prefix)
        if (parsed === null) {
          await onUnrouted?.(message, null)
          return
        }
        const route = registry.routes.get(parsed.command)
        if (route === undefined) {
          await onUnrouted?.(message, parsed.command)
          return
        }
        const spec = route.spec
        if (spec.respond !== undefined) {
          await send(message.channel, message.conversationId, { text: spec.respond })
          return
        }
        const invocation: Invocation = {
          command: parsed.command,
          args: bindArgs(parsed.rest, spec.args ?? []),
          rest: parsed.rest,
          message,
        }
        const instance = route.enzyme.instance
        if (instance === null) {
          // A `code:` command with no loaded instance is a conformance gap the kit
          // should have caught before germination; staying silent would hide it from
          // both the user and the operator instead of surfacing it like a thrown handler.
          logger.error(`enzyme '${route.plugin}' has no handler for '${route.qualified}'`, {})
          await send(message.channel, message.conversationId, {
            text: `command '${parsed.command}' failed`,
          })
          return
        }
        // Object.hasOwn, never a plain index: a plugin-supplied handlers object walks
        // Object.prototype otherwise, and `code: constructor` would resolve to a native
        // function instead of the dormancy germination already refused this shape into.
        const handler = Object.hasOwn(instance.handlers, spec.code) ? instance.handlers[spec.code] : undefined
        if (handler === undefined) {
          // Germination refuses this, so reaching it means the registry was built elsewhere.
          logger.error(`enzyme '${route.plugin}' has no handler '${spec.code}'`)
          await send(message.channel, message.conversationId, {
            text: `command '${parsed.command}' failed`,
          })
          return
        }
        try {
          await handler(invocation, contextFor(message))
        } catch (e) {
          // A handler that throws is contained: clean error on the channel, trace logged.
          logger.error(`enzyme '${route.plugin}' threw handling '${route.qualified}'`, {
            error: (e as Error).message,
          })
          try {
            await send(message.channel, message.conversationId, {
              text: `command '${parsed.command}' failed`,
            })
          } catch (sendError) {
            // The channel that failed is the same one we would answer on: there is
            // nowhere left to report to but the log.
            logger.error(`could not report the failure of '${route.qualified}' on '${channel}'`, {
              error: (sendError as Error).message,
            })
          }
        }
      } catch (e) {
        logger.error(`delivery on '${channel}' failed`, { error: (e as Error).message })
      }
    },
  }
}
