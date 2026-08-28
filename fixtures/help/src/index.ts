import type { CommandsRead, EnzymeModule } from '@mycelo/septum'

// design §10, §6: filtered on authorization and rendered in the reader's locale. The scope is
// what stops the list naming a command this channel would then refuse (spec §7).
export default {
  create: () => ({
    handlers: {
      handleHelp: async (invocation, ctx) => {
        const commands = await ctx.rhiza<CommandsRead>('mycelium').available(
          ctx.principal,
          ctx.locale,
          {
            channel: invocation.message.channel,
            kind: invocation.message.group === undefined ? 'dm' : 'group',
          },
        )
        const lines = commands
          .map((c) => ctx.t('reply.line', { name: c.name, description: c.description }))
          .join('\n')
        await ctx.reply({ text: ctx.t('reply.list', { lines }) })
      },
    },
  }),
} satisfies EnzymeModule
