import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Shared ESLint flat config for GameShelf workspaces.
 *
 * Workspaces re-export this from their own `eslint.config.mjs` and add
 * framework-specific rules on top.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/out/**',
      '**/*.config.*',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },
);
