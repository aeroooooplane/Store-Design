import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
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
    // Only the two classic hook rules; the React Compiler rules of the plugin's preset are not used.
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      // A warning for now: existing incomplete dependency lists are fixed one by one.
      'react-hooks/exhaustive-deps': 'warn',
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
