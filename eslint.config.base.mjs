import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import tseslint from 'typescript-eslint';

/**
 * Shared ESLint flat config for GameShelf workspaces.
 *
 * Workspaces re-export this from their own `eslint.config.mjs` and add
 * framework-specific rules on top. The typed `strict`/`stylistic` presets
 * require `parserOptions.projectService` to be enabled by the workspace.
 * `eslint-config-prettier` goes last so formatting stays Prettier's job.
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
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },
  eslintConfigPrettier,
);
