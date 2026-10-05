import { FlatCompat } from '@eslint/eslintrc';
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import base from '../../eslint.config.base.mjs';

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

export default [
  ...base,
  ...compat.extends('next/core-web-vitals'),
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    // Next's `no-html-link-for-pages` rule resolves `pages`/`app` from the
    // ESLint cwd; point it at the web app so linting from the repo root
    // (e.g. the pre-commit hook) does not warn about missing directories.
    settings: {
      next: {
        rootDir: import.meta.dirname,
      },
    },
  },
  eslintConfigPrettier,
];
