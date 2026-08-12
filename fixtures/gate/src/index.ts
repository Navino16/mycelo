import type { ConfigSchema, InhibitorModule } from '@mycelo/septum'

interface Config {
  channel: string
  groupId: string
}

// Hand-rolled rather than a Zod schema: ConfigSchema is duck-typed on safeParse, and no
// other fixture depends on zod, so pulling it in here for one object shape is not worth it.
const configSchema: ConfigSchema<Config> = {
  safeParse(input: unknown) {
    if (typeof input !== 'object' || input === null) {
      return { success: false, error: 'gate config must be an object' }
    }
    const { channel, groupId } = input as Record<string, unknown>
    if (typeof channel !== 'string' || channel.length === 0) {
      return { success: false, error: "gate config needs a non-empty 'channel'" }
    }
    if (typeof groupId !== 'string' || groupId.length === 0) {
      return { success: false, error: "gate config needs a non-empty 'groupId'" }
    }
    return { success: true, data: { channel, groupId } }
  },
}

export default {
  configSchema,
  create: () => {
    let config: Config | null = null
    return {
      start: (ctx) => {
        config = ctx.config
        // Fails germination rather than admitting everyone: a security rule is never
        // silently inert (spec §5.1, design §7).
        ctx.requireCapability(config.channel, 'group_membership')
        return Promise.resolve()
      },
      // shape.ts requires start() and stop() paired, even though this inhibitor holds
      // no resource to release.
      stop: () => Promise.resolve(),
      inspect: async (message, ctx) => {
        if (config === null) return { allow: false, reason: 'gate did not start' }
        if (message.channel !== config.channel) return { allow: true }
        const members = await ctx.groupMembers(config.channel, config.groupId)
        if (members === null) return { allow: false, reason: 'group membership is unavailable' }
        const member = members.some(
          (m) => m.channel === message.sender.channel && m.externalId === message.sender.externalId,
        )
        return member ? { allow: true } : { allow: false, reason: 'not a member of the group' }
      },
    }
  },
} satisfies InhibitorModule<Config>
