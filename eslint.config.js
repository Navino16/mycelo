import { defineConfig, globalIgnores } from 'eslint/config'
import tseslint from 'typescript-eslint'

export default defineConfig(
  // .superpowers/ is gitignored scratch outside every tsconfig, so one .ts probe dropped
  // there aborts `eslint .` — and therefore `bun run ci` — on an otherwise correct tree.
  globalIgnores(['**/dist/**', '**/node_modules/**', '**/.superpowers/**']),
  tseslint.configs.recommendedTypeChecked,
  {
    // Each package's tsconfig.json excludes test files on purpose (see its own
    // comment), so projectService's directory walk never finds a project for them.
    // Route them to tsconfig.spec.json, the one config that does include tests.
    files: ['**/*.test.ts', 'packages/**/test/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { project: './tsconfig.spec.json', tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Test doubles implement an async interface without needing to await
      // anything; that is a stub, not a bug.
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    files: ['packages/**/*.ts'],
    ignores: ['**/*.test.ts', 'packages/**/test/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ['fixtures/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { project: './tsconfig.spec.json', tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // Build-time tool config, outside every tsconfig's include; projectService
    // cannot find a project for it, so type-aware parsing is not an option.
    files: ['**/drizzle.config.ts'],
    extends: [tseslint.configs.disableTypeChecked],
  },
)
