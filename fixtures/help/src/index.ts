import type { EnzymeModule, PluginsRead } from '@mycelo/septum'

// design §11.2: built against plugins.read as it exists today, deliberately inadequate.
// PluginInfo.commands is short names only — no description, no per-sender filter.
export default {
  create: () => ({
    handlers: {
      handleHelp: async (_invocation, ctx) => {
        const mycelium = ctx.rhiza<PluginsRead>('mycelium')
        const names = mycelium.listPlugins().flatMap((p) => p.commands)
        await ctx.reply({ text: ctx.t('reply.list', { names: names.join(', ') }) })
      },
    },
  }),
} satisfies EnzymeModule
