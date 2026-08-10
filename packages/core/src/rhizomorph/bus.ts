import type {
  Capabilities,
  ChannelCapability,
  EnzymeContext,
  IncomingMessage,
  Invocation,
  Logger,
  OutgoingContent,
  Principal,
  PushTarget,
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

  function contextFor(message: IncomingMessage): EnzymeContext {
    const origin = hyphaByName.get(message.channel)
    return {
      // Plugin settings live in the database from phase 5; nothing supplies them yet.
      config: {},
      logger: logger.child({ channel: message.channel }),
      reply: async (content) => { await send(message.channel, message.conversationId, content) },
      push: async (target: PushTarget, content) => { await send(target.channel, target.conversationId, content) },
      capabilities: capabilitiesOf(origin),
      capabilitiesOf: (target) => capabilitiesOf(hyphaByName.get(target.channel)),
      rhiza: () => notYet('ctx.rhiza()', 'phase 3 (anastomoses)'),
      has: () => false,
      on: () => notYet('ctx.on()', 'phase 3 (anastomoses)'),
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
        const spec = route.enzyme.manifest.commands.find((c) => c.name === parsed.command)
        const invocation: Invocation = {
          command: parsed.command,
          args: bindArgs(parsed.rest, spec?.args ?? []),
          rest: parsed.rest,
          message,
        }
        try {
          await route.enzyme.instance.handle(invocation, contextFor(message))
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
