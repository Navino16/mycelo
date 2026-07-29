import { defineConfig, globalIgnores } from 'eslint/config'
import tseslint from 'typescript-eslint'

export default defineConfig(
  globalIgnores(['**/dist/**', '**/node_modules/**']),
  {
    files: ['**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    rules: {
      // The compiler cannot enforce this: erasableSyntaxOnly accepts decorators,
      // but Node rejects them at load time when type-stripping.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Decorator',
          message:
            'Decorators are not allowed: Node cannot type-strip them, so the spore would break when loaded through the local driver.',
        },
      ],
    },
  },
)
