import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'packages/*/conformance/**/*.test.ts'],
    environment: 'node',
  },
})
