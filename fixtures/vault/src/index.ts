import { defineConfig } from '@mycelo/septum'
import type { EnzymeModule } from '@mycelo/septum'
import { z } from 'zod'

const schema = z.object({
  url: z.string().default('http://example.invalid'),
  token: z.string().default(''),
})

type Config = z.infer<typeof schema>

export default {
  configSchema: defineConfig(schema, { secrets: ['token'] }),
  create: () => ({
    handlers: {
      handleVault: async (_invocation, ctx) => {
        await ctx.reply({
          text: ctx.config.token === ''
            ? ctx.t('reply.unset')
            : ctx.t('reply.set', { url: ctx.config.url }),
        })
      },
    },
  }),
} satisfies EnzymeModule<Config>
