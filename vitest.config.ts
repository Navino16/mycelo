import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Tests live in test/. The src/ patterns are the safety net: a stray test
    // there must still run rather than be silently skipped.
    include: [
      'packages/*/test/**/*.test.ts',
      'packages/*/src/**/*.test.ts',
      'fixtures/*/test/**/*.test.ts',
      'fixtures/*/src/**/*.test.ts',
    ],
    environment: 'node',
  },
})
