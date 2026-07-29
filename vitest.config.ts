import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The conformance kit lives under src/, so one pattern covers everything.
    // A packages/*/conformance/** pattern would make a misplaced kit appear to
    // work while the published entry points pointed at paths that never exist.
    include: ['packages/*/src/**/*.test.ts', 'fixtures/*/src/**/*.test.ts'],
    environment: 'node',
  },
})
