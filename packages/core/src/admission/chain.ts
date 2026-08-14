import type { IncomingMessage, InhibitorContext, Logger, MyceliumScope, Verdict } from '@mycelo/septum'
import type { GerminatedInhibitor, GerminatedRhiza } from '../germination/registry.js'
import type { MembershipCache } from './membership.js'

/**
 * Mirrors createEnzymeStartContext's rhiza() (bus.ts), including the distinction
 * between "not declared in this spore's requires" and "resolved but failed to start"
 * (phase 3) — a looser copy here would quietly lose it.
 */
export function createInhibitorContext(options: {
  inhibitor: GerminatedInhibitor
  membership: MembershipCache
  logger: Logger
  rhizas: readonly GerminatedRhiza[]
  mycelium: (scopes: readonly MyceliumScope[]) => object
}): InhibitorContext {
  const { inhibitor, membership, logger, rhizas, mycelium } = options
  const byName = new Map(rhizas.map((r) => [r.name, r]))
  return {
    config: inhibitor.config,
    logger,
    groupMembers: (channel, groupId) => membership.members(channel, groupId),
    requireCapability: (channel, capability) => { membership.requireCapability(channel, capability) },
    rhiza: <TApi>(name: string): TApi => {
      if (!inhibitor.resolved.has(name)) {
        throw new Error(`rhiza '${name}' is not declared in this spore's requires`)
      }
      if (name === 'mycelium') return mycelium(inhibitor.scopes) as TApi
      const found = byName.get(name)
      if (found === undefined) throw new Error(`rhiza '${name}' resolved but failed to start and is unavailable`)
      return found.instance.api as TApi
    },
    has: (name) => inhibitor.resolved.has(name),
  }
}

export interface AdmissionChain {
  admit(message: IncomingMessage): Promise<Verdict>
}

/**
 * design §7: `enforcing` governs the handling of an inhibitor's *errors*, not its
 * *refusals*. A refusal — advisory or enforcing — is final. Only a throw is forgiving,
 * and only for an advisory inhibitor.
 */
export function createAdmissionChain(options: {
  inhibitors: readonly GerminatedInhibitor[]
  /** Names of enforcing inhibitors that never started. Any one of them refuses everything. */
  brokenEnforcing: readonly string[]
  membership: MembershipCache
  logger: Logger
  rhiza: (inhibitor: GerminatedInhibitor) => <T>(name: string) => T
  /** Channels each inhibitor is confined to. Read once per message so an operator's change is live. */
  channelScopes: () => ReadonlyMap<string, readonly string[]>
}): AdmissionChain {
  const { inhibitors, brokenEnforcing, membership, logger, rhiza, channelScopes } = options
  const ordered = [...inhibitors].sort((a, b) => a.name.localeCompare(b.name))
  // Same attribution start() gets (mycelium.ts), so an inhibitor's records name it in
  // both moments rather than only during startup.
  const loggerFor = new Map(inhibitors.map((i) => [i.name, logger.child({ inhibitor: i.name })]))

  return {
    async admit(message) {
      const scopes = channelScopes()
      const appliesHere = (name: string): boolean => {
        const channels = scopes.get(name)
        return channels === undefined || channels.length === 0 || channels.includes(message.channel)
      }
      // Confining an inhibitor that then breaks must not brick the channels it was never
      // meant to guard — otherwise the confinement is worse than not having it.
      const broken = brokenEnforcing.find(appliesHere)
      if (broken !== undefined) {
        return { allow: false, reason: `inhibitor '${broken}' never started: all traffic is refused` }
      }
      for (const inhibitor of ordered) {
        if (!appliesHere(inhibitor.name)) continue
        const ctx: InhibitorContext = {
          config: inhibitor.config,
          logger: loggerFor.get(inhibitor.name) ?? logger,
          groupMembers: (channel, groupId) => membership.members(channel, groupId),
          requireCapability: (channel, capability) => { membership.requireCapability(channel, capability) },
          rhiza: rhiza(inhibitor),
          has: (name) => inhibitor.resolved.has(name),
        }
        try {
          const verdict = await inhibitor.instance.inspect(message, ctx)
          // `allow` is a plugin-supplied value that decides admission, and a bare
          // !verdict.allow admits any truthy non-boolean. Routed through the throw path
          // so a malformed verdict fails closed for an enforcing inhibitor.
          const allow: unknown = (verdict as { allow?: unknown } | null | undefined)?.allow
          if (typeof allow !== 'boolean') {
            throw new Error(`inspect() returned no boolean 'allow' (got ${typeof allow})`)
          }
          if (!allow) return verdict
        } catch (e) {
          const reason = (e as Error).message
          if (inhibitor.manifest.enforcing) {
            logger.error(`enforcing inhibitor '${inhibitor.name}' threw, refusing all traffic: ${reason}`)
            return { allow: false, reason: `inhibitor '${inhibitor.name}' failed: ${reason}` }
          }
          logger.warn(`inhibitor '${inhibitor.name}' threw and was skipped: ${reason}`)
        }
      }
      return { allow: true }
    },
  }
}
