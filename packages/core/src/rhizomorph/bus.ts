import type {
  Capabilities,
  ChannelCapability,
  ConversationKind,
  EnzymeContext,
  EnzymeStartContext,
  IncomingMessage,
  Invocation,
  Logger,
  MyceliumScope,
  OutgoingContent,
  Principal,
} from '@mycelo/septum'
import type { AdmissionChain } from '../admission/chain.js'
import { conversationKind, recordConversation } from '../conversations/registry.js'
import type { GerminatedHypha, GerminatedRhiza, Registry } from '../germination/registry.js'
import { authorize } from '../authorization/check.js'
import { patternsOf, resolvePrincipal } from '../identity/resolve.js'
import { bindTranslate } from '../i18n/bind.js'
import { localeForTarget, resolveLocale } from '../i18n/locale.js'
import type { Translator } from '../i18n/translator.js'
import { createMyceliumApi } from '../mycelium-rhiza.js'
import type { Db } from '../persistence/db.js'
import { contextRuleFor } from '../restrictions/rules.js'
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

export async function sendVia(
  hyphaByName: ReadonlyMap<string, GerminatedHypha>,
  channel: string,
  conversationId: string,
  out: OutgoingContent,
): Promise<void> {
  const hypha = hyphaByName.get(channel)
  if (hypha === undefined) throw new Error(`no hypha named '${channel}'`)
  // The published contract (septum's OutgoingContent) promises this is enforced by
  // the core. It previously was not: ctx.reply({}) reached the hypha untouched.
  if (out.text === undefined && out.attachments === undefined && out.reactTo === undefined) {
    throw new Error('OutgoingContent must set at least one of text, attachments, or reactTo')
  }
  await hypha.instance.send(conversationId, out)
}

/** A calling spore's own resolved set and mycelium scopes — never the registry's. */
export interface SporeAccess {
  resolved: ReadonlySet<string>
  scopes: readonly MyceliumScope[]
}

export interface StartContextOptions {
  hyphae: readonly GerminatedHypha[]
  rhizas: readonly GerminatedRhiza[]
  logger: Logger
  access: SporeAccess
  /** Injected so bus.ts does not import mycelium-rhiza.ts, which imports Registry. */
  mycelium: (scopes: readonly MyceliumScope[]) => object
  config: unknown
  /** The calling spore's own name: the domain a bare string key in t() resolves against. */
  domain: string
  translator: Translator
  db: Db
  /** Locale for t() and localeFor() when nothing more specific is known. */
  defaultLocale: string
}

/**
 * The message-independent slice of EnzymeContext — push, capabilitiesOf, rhiza, has,
 * on — built once per spore so boot/start.ts's Enzyme.start() call (before any message
 * exists) and createBus()'s per-message context below share one implementation.
 */
export function createEnzymeStartContext(options: StartContextOptions): EnzymeStartContext {
  const { hyphae, rhizas, logger, access, mycelium, config, domain, translator, db, defaultLocale } = options
  const hyphaByName = new Map(hyphae.map((h) => [h.name, h]))
  const rhizaByName = new Map(rhizas.map((r) => [r.name, r]))

  function rhiza<TApi>(name: string): TApi {
    if (!access.resolved.has(name)) {
      throw new Error(`rhiza '${name}' is not declared in this spore's requires`)
    }
    if (name === 'mycelium') return mycelium(access.scopes) as TApi
    const found = rhizaByName.get(name)
    // Resolution (anastomoses.ts) only ever puts a genuine rhiza in `access.resolved`,
    // so reaching here with no match means that rhiza's own start() failed at runtime —
    // never that it was never installed (core spec §8; the cascade to this enzyme is deferred).
    if (found === undefined) throw new Error(`rhiza '${name}' resolved but failed to start and is unavailable`)
    return found.instance.api as TApi
  }

  return {
    config,
    logger,
    push: async (target, content) => { await sendVia(hyphaByName, target.channel, target.conversationId, content) },
    capabilitiesOf: (target) => capabilitiesOf(hyphaByName.get(target.channel)),
    rhiza,
    has: (name) => access.resolved.has(name),
    on: () => notYet('ctx.on()', 'a phase not yet scheduled for rhiza domain events (design §12)'),
    t: bindTranslate({ translator, domain, allowed: access.resolved, localeOf: () => defaultLocale }),
    localeFor: (target) => Promise.resolve(localeForTarget(db, target, defaultLocale)),
  }
}

export interface Bus {
  deliver(channel: string, raw: IncomingMessage): Promise<void>
}

export interface BusOptions {
  registry: Registry
  prefix: string
  logger: Logger
  db: Db
  admission: AdmissionChain
  /** Where the mycelium API reaches a spore on disk, for plugins.toggle and plugins.configure. */
  sporesDirs: readonly string[]
  /** Assigned to a principal on first contact only (identity/resolve.ts). */
  defaultRole?: string
  /** Required by locale.manage and by every enzyme's ctx.t(): every caller has one. */
  translator: Translator
  /** Resolved per message by resolveLocale(); used as-is for start() contexts. */
  defaultLocale: string
  /** Called when text carries no command, or names one nothing declares. */
  onUnrouted?: (message: IncomingMessage, command: string | null, locale: string) => Promise<void>
  /** Sent verbatim when authorization refuses. */
  onDenied?: (message: IncomingMessage, qualified: string, locale: string) => Promise<void>
  /** Called when the emitting channel does not declare a capability the command requires. */
  onUnsupported?: (message: IncomingMessage, qualified: string, capability: ChannelCapability, locale: string) => Promise<void>
  /** Called when a context rule confines the command to the other conversation kind. */
  onOutOfContext?: (message: IncomingMessage, qualified: string, where: ConversationKind, locale: string) => Promise<void>
  /** Defaults to the real mycelium-as-rhiza API, grounded in this bus's own registry (design §2.4). */
  mycelium?: (scopes: readonly MyceliumScope[]) => object
}

export function createBus({
  registry, prefix, logger, db, admission, sporesDirs, defaultRole, translator, defaultLocale,
  onUnrouted, onDenied, onUnsupported, onOutOfContext, mycelium,
}: BusOptions): Bus {
  const hyphaByName = new Map(registry.hyphae.map((h) => [h.name, h]))
  const send = (channel: string, conversationId: string, out: OutgoingContent): Promise<void> =>
    sendVia(hyphaByName, channel, conversationId, out)
  const mounted = mycelium ?? ((scopes: readonly MyceliumScope[]) =>
    createMyceliumApi(
      registry,
      scopes,
      (target, content) => send(target.channel, target.conversationId, content),
      db,
      sporesDirs,
      { defaultRole, translator },
    ))

  // One context per enzyme, because `resolved` and `scopes` differ per spore
  // (design §2.4). Built once here rather than per message.
  const startContextByEnzyme = new Map(
    registry.enzymes.map((enzyme) => [
      enzyme.name,
      createEnzymeStartContext({
        hyphae: registry.hyphae,
        rhizas: registry.rhizas,
        logger,
        access: { resolved: enzyme.resolved, scopes: enzyme.scopes },
        mycelium: mounted,
        config: enzyme.config,
        domain: enzyme.name,
        translator,
        db,
        defaultLocale,
      }),
    ]),
  )
  const enzymeAccess = new Map(registry.enzymes.map((enzyme) => [enzyme.name, enzyme.resolved]))

  function contextFor(
    message: IncomingMessage, enzymeName: string, principal: Principal, locale: string,
  ): EnzymeContext {
    const origin = hyphaByName.get(message.channel)
    const startContext = startContextByEnzyme.get(enzymeName)
    if (startContext === undefined) throw new Error(`no start context built for enzyme '${enzymeName}'`)
    return {
      ...startContext,
      logger: logger.child({ channel: message.channel }),
      reply: async (content) => { await send(message.channel, message.conversationId, content) },
      // Rebound, not inherited: the start context's t answers in the default locale,
      // which inside a handler would ignore the reader entirely.
      t: bindTranslate({
        translator,
        domain: enzymeName,
        allowed: enzymeAccess.get(enzymeName) ?? new Set(),
        localeOf: () => locale,
      }),
      capabilities: capabilitiesOf(origin),
      get principal(): Principal { return principal },
      locale,
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

        const verdict = await admission.admit(message)
        if (!verdict.allow) {
          // Silent on the channel: the bot does not confirm its existence to someone
          // with no right to address it (design §3.1).
          logger.info(`admission refused a message on '${channel}'`, { reason: verdict.reason })
          return
        }

        // After admission, never before: a refused spammer must not pollute the list an
        // operator picks broadcast targets from. A failure here is logged and delivery
        // continues — the registry is a convenience, and losing the message would cost more.
        try {
          recordConversation(db, message)
        } catch (e) {
          logger.error(`could not record the conversation on '${channel}'`, { error: (e as Error).message })
        }

        let principal: Principal
        try {
          principal = resolvePrincipal(db, message.sender, defaultRole === undefined ? {} : { defaultRole })
        } catch (e) {
          // No principal means no authorization, so passing the message on would be a fail-open.
          logger.error(`could not resolve the sender on '${channel}'`, { error: (e as Error).message })
          return
        }
        const locale = resolveLocale(db, message.channel, message.conversationId, principal.id, defaultLocale)

        const parsed = parseCommand(message.text, prefix)
        if (parsed === null) {
          await onUnrouted?.(message, null, locale)
          return
        }
        const route = registry.routes.get(parsed.command)
        if (route === undefined) {
          await onUnrouted?.(message, parsed.command, locale)
          return
        }

        // A respond: command is authorized too: it has no handler, but letting it
        // through unchecked would make respond: a way around authorization entirely.
        if (!authorize(route.qualified, patternsOf(db, principal.id))) {
          await onDenied?.(message, route.qualified, locale)
          return
        }

        const spec = route.spec

        // After authorization, never before: a refusal that named a command to someone with
        // no right to it would leak the command's existence.
        const origin = capabilitiesOf(hyphaByName.get(message.channel))
        const missing = (spec.capabilities ?? []).find((capability) => !origin.has(capability))
        if (missing !== undefined) {
          await onUnsupported?.(message, route.qualified, missing, locale)
          return
        }

        // Operator policy, after the author's declaration and after the role check: the
        // one step that knows route.qualified (design note §2b).
        const where = contextRuleFor(db, route.qualified)
        if (where !== null && where !== conversationKind(message)) {
          await onOutOfContext?.(message, route.qualified, where, locale)
          return
        }

        if (spec.respond !== undefined) {
          try {
            // design §5.2: respond: is a catalogue key in the declaring spore's domain. An
            // absent key renders literally, so a plugin with no catalogue is unaffected.
            await send(message.channel, message.conversationId, {
              text: translator.translate(route.plugin, spec.respond, locale),
            })
          } catch (e) {
            // Named the same way the code: path already does, so an operator can tell
            // which command was lost rather than only which channel failed.
            logger.error(`failed to send the reply for '${route.qualified}'`, {
              error: (e as Error).message,
            })
          }
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
            text: translator.translate('core', 'command.failed', locale, { command: parsed.command }),
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
            text: translator.translate('core', 'command.failed', locale, { command: parsed.command }),
          })
          return
        }
        try {
          await handler(invocation, contextFor(message, route.plugin, principal, locale))
        } catch (e) {
          // A handler that throws is contained: clean error on the channel, trace logged.
          logger.error(`enzyme '${route.plugin}' threw handling '${route.qualified}'`, {
            error: (e as Error).message,
          })
          try {
            await send(message.channel, message.conversationId, {
              text: translator.translate('core', 'command.failed', locale, { command: parsed.command }),
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
