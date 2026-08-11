import { defineConfig, globalIgnores } from 'eslint/config'
import tseslint from 'typescript-eslint'

// The decorator ban applies to every TypeScript file, test files included.
const noDecorators = {
  'no-restricted-syntax': [
    'error',
    {
      selector: 'Decorator',
      message:
        'Decorators are not allowed: Node cannot type-strip them, so the spore would break when loaded through the local driver.',
    },
  ],
}

export default defineConfig(
  globalIgnores(['**/dist/**', '**/node_modules/**']),
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
      ...noDecorators,
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
    rules: {
      // The compiler cannot enforce this: erasableSyntaxOnly accepts decorators,
      // but Node rejects them at load time when type-stripping.
      ...noDecorators,
    },
  },
  {
    files: ['fixtures/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { project: './tsconfig.spec.json', tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      ...noDecorators,
    },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
)
