import type { EnzymeModule } from '@mycelo/septum'

export default {
  create: () => ({
    handlers: {
      // Two commands share this handler; invocation.command tells them apart.
      handleMutation: async (invocation, ctx) => {
        await ctx.reply({ text: `${invocation.command}: ${invocation.rest || 'nothing'}` })
      },
    },
  }),
} satisfies EnzymeModule
