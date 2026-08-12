import type { EnzymeModule } from '@mycelo/septum'

// The author's own assertion of the rhiza's shape (context.ts §EnzymeStartContext); the core
// never verifies it against mock's actual api.
interface MockApi {
  lookup(title: string): string
}

const ANY_OF_ALTERNATIVES = ['nowhere', 'mock']

export default {
  create: () => ({
    handlers: {
      handleMovies: async (invocation, ctx) => {
        const api = ctx.rhiza<MockApi>('mock')
        await ctx.reply({ text: `${api.lookup(invocation.rest)} via mock` })
      },
      handleWhere: async (_invocation, ctx) => {
        const present = ANY_OF_ALTERNATIVES.filter((name) => ctx.has(name))
        const absent = ANY_OF_ALTERNATIVES.filter((name) => !ctx.has(name))
        await ctx.reply({ text: `resolved to ${present.join(', ')} (${absent.join(', ')} is absent)` })
      },
    },
  }),
} satisfies EnzymeModule
