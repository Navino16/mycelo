import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Tests live in test/, mirroring src/. The src/ patterns are the safety net,
    // not the convention: a test file left in src/ must still run and fail loudly
    // rather than be silently skipped. Keeping it out of dist/ is the tsconfig
    // exclude's job, not this glob's.
    include: [
      'packages/*/test/**/*.test.ts',
      'packages/*/src/**/*.test.ts',
      'fixtures/*/test/**/*.test.ts',
      'fixtures/*/src/**/*.test.ts',
    ],
    environment: 'node',
  },
})
