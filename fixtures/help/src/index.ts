import type { CommandsRead, EnzymeModule } from '@mycelo/septum'

// design §10, §6: filtered on authorization and rendered in the reader's locale.
export default {
  create: () => ({
    handlers: {
      handleHelp: async (_invocation, ctx) => {
        const commands = await ctx.rhiza<CommandsRead>('mycelium').available(ctx.principal, ctx.locale)
        const lines = commands
          .map((c) => ctx.t('reply.line', { name: c.name, description: c.description }))
          .join('\n')
        await ctx.reply({ text: ctx.t('reply.list', { lines }) })
      },
    },
  }),
} satisfies EnzymeModule
