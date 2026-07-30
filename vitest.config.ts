import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Tests live in test/, mirroring src/. Keeping them out of src/ makes the
    // published boundary structural: everything under src/ ships, with no
    // exclude to remember. A test file cannot end up in dist/ by omission.
    include: ['packages/*/test/**/*.test.ts', 'fixtures/*/test/**/*.test.ts'],
    environment: 'node',
  },
})
