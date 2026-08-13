import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './packages/core/src/persistence/schema.ts',
  out: './packages/core/migrations',
})
