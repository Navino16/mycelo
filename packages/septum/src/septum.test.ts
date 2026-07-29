import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { EnzymeModule } from './enzyme.js'
import type { HyphaModule } from './hypha.js'
import type { InhibitorModule } from './inhibitor.js'
import type { RhizaModule } from './rhiza.js'
import type { ConfigSchema } from './spore.js'

// ---- A hypha with a real Zod config schema ------------------------------
const signalConfig = z.object({
  account: z.string(),
  rpcUrl: z.string(),
  timeoutMs: z.number().default(5000),
})
type SignalConfig = z.infer<typeof signalConfig>

/** THE key assertion: a Zod schema satisfies ConfigSchema structurally. */
const asContract: ConfigSchema<SignalConfig> = signalConfig

const signalModule: HyphaModule<SignalConfig> = {
  configSchema: signalConfig,
  create() {
    return {
      async start(ctx) {
        ctx.logger.info('connecting', { account: ctx.config.account })
        void ctx.config.timeoutMs
      },
      async stop() {},
      async send(conversationId, out) {
        void conversationId
        void out.text
      },
      async listGroupMembers(groupId) {
        return [{ channel: 'signal', externalId: `member-of-${groupId}` }]
      },
    }
  },
}

// ---- A rhiza exposing a typed API --------------------------------------
interface RadarrApi {
  search(term: string): Promise<readonly { id: number; title: string }[]>
  upcoming(days: number): Promise<readonly { title: string; date: Date }[]>
}
const radarrConfig = z.object({ url: z.string(), apiKey: z.string() })
type RadarrConfig = z.infer<typeof radarrConfig>

const radarrModule: RhizaModule<RadarrConfig, RadarrApi> = {
  configSchema: radarrConfig,
  create() {
    const api: RadarrApi = {
      async search(term) {
        return [{ id: 1, title: term }]
      },
      async upcoming(days) {
        return [{ title: 'x', date: new Date(days) }]
      },
    }
    return {
      async start(ctx) {
        ctx.emit('ready', { url: ctx.config.url })
      },
      async stop() {},
      async health() {
        return { state: 'healthy' as const, checkedAt: new Date(0) }
      },
      api,
    }
  },
}

// ---- An enzyme consuming that rhiza, with no config of its own ---------
const upcomingModule: EnzymeModule = {
  create() {
    return {
      async start(ctx) {
        ctx.on('radarr', 'ready', () => ctx.logger.info('radarr ready'))
        // start() gets the restricted context. These three exist only once a
        // message has arrived, and @ts-expect-error is what keeps that true:
        // if any of them is ever added back to EnzymeStartContext, the unused
        // directive becomes an error and this test fails.
        // @ts-expect-error principal does not exist before a message arrives
        void ctx.principal
        // @ts-expect-error reply has no conversation to answer into
        void ctx.reply
        // @ts-expect-error capabilities are relative to a conversation
        void ctx.capabilities
      },
      async handle(inv, ctx) {
        // Adapting to a channel that cannot take attachments (spec §3.2).
        if (!ctx.capabilities.has('attachments')) {
          await ctx.reply({ text: 'text only' })
          return
        }
        const radarr = ctx.rhiza<RadarrApi>('radarr')
        const films = await radarr.upcoming(Number(inv.args['days'] ?? '7'))
        await ctx.reply({ text: films.map((f) => f.title).join(', ') })
        // Branching by hand inside an any_of group (spec §6).
        if (ctx.has('plex')) {
          await ctx.push({ channel: 'signal', conversationId: 'g:1' }, { text: 'also on plex' })
        }
        void ctx.principal.roles.length
        void inv.rest
      },
    }
  },
}

// ---- An inhibitor doing group admission --------------------------------
const gateConfig = z.object({ channel: z.string(), groupId: z.string() })

const gateModule: InhibitorModule<z.infer<typeof gateConfig>> = {
  configSchema: gateConfig,
  create() {
    return {
      async inspect(message, ctx) {
        const members = await ctx.groupMembers(ctx.config.channel, ctx.config.groupId)
        if (members === null) return { allow: false, reason: 'membership unavailable' }
        const ok = members.some((m) => m.externalId === message.sender.externalId)
        return ok ? { allow: true } : { allow: false, reason: 'not a group member' }
      },
    }
  },
}

describe('septum contract', () => {
  it('is implementable by all four kinds', () => {
    // If this file compiles, the contract holds. The runtime assertion only
    // keeps the test runner from reporting an empty suite.
    expect([asContract, signalModule, radarrModule, upcomingModule, gateModule]).toHaveLength(5)
  })

  it('exposes create() on every module', () => {
    for (const m of [signalModule, radarrModule, upcomingModule, gateModule]) {
      expect(typeof m.create).toBe('function')
    }
  })
})
