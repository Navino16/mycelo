import type { EnzymeModule, PluginsRead } from '@mycelo/septum'

export default {
  create: () => ({
    handlers: {
      handlePlugins: async (_invocation, ctx) => {
        const mycelium = ctx.rhiza<PluginsRead>('mycelium')
        const names = mycelium.listPlugins().map((p) => p.name).join(', ')
        await ctx.reply({ text: names })
      },
    },
  }),
} satisfies EnzymeModule
