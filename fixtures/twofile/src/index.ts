import type { EnzymeModule } from '@mycelo/septum'
// The .js specifier is the point: Node cannot resolve it to greeting.ts, Bun can.
import { greet } from './greeting.js'

export default {
  create: () => ({
    handlers: {
      handleTwo: async (invocation, ctx) => {
        await ctx.reply({ text: greet(invocation.rest || 'world') })
      },
    },
  }),
} satisfies EnzymeModule
