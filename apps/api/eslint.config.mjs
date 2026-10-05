import eslintConfigPrettier from 'eslint-config-prettier/flat';
import base from '../../eslint.config.base.mjs';

export default [
  ...base,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      // NestJS modules/controllers are marker classes whose behaviour comes
      // from decorators, so an empty class body is expected here.
      '@typescript-eslint/no-extraneous-class': [
        'error',
        { allowWithDecorator: true },
      ],
    },
  },
  eslintConfigPrettier,
];
