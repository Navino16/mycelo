import type { EnzymeModule, TranslatableRef } from '@mycelo/septum'

// The author's own assertion of the rhiza's shape (context.ts §EnzymeStartContext); the core
// never verifies it against mock's actual api.
interface MockApi {
  lookup(title: string): string | TranslatableRef
}

const ANY_OF_ALTERNATIVES = ['nowhere', 'mock']

export default {
  create: () => ({
    handlers: {
      handleMovies: async (invocation, ctx) => {
        const found = ctx.rhiza<MockApi>('mock').lookup(invocation.rest)
        // A ref crosses a domain boundary the manifest declares; a string is mock's own
        // data and stays untranslated.
        const title = typeof found === 'string' ? found : ctx.t(found)
        await ctx.reply({ text: ctx.t('movies.found', { title }) })
      },
      handleCount: async (invocation, ctx) => {
        const n = Number.parseInt(invocation.rest.trim(), 10)
        if (Number.isNaN(n)) {
          await ctx.reply({ text: ctx.t('movies.count-usage') })
          return
        }
        await ctx.reply({ text: ctx.t('movies.count', { n }) })
      },
      handleWhere: async (_invocation, ctx) => {
        const present = ANY_OF_ALTERNATIVES.filter((name) => ctx.has(name))
        const absent = ANY_OF_ALTERNATIVES.filter((name) => !ctx.has(name))
        await ctx.reply({ text: `resolved to ${present.join(', ')} (${absent.join(', ')} is absent)` })
      },
    },
  }),
} satisfies EnzymeModule
