import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    // Only the TypeScript workspace is linted; legacy code and data folders keep their own tooling.
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'demo/**',
      'legacy/**',
      'tools/**',
      'tmp/**',
      'output/**',
      'docs/**',
      '资源库/**',
      '素材库/**',
      'database/migrations/**',
      'apps/web/src/api/schema.d.ts',
      'eslint.config.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-floating-promises': 'error',
      // Fastify plugins and hooks are async by contract even when they do not await anything.
      '@typescript-eslint/require-await': 'off',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      // Assertions on parsed JSON responses are intentionally loose in tests.
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
)
