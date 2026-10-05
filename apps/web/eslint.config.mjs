import { FlatCompat } from '@eslint/eslintrc';
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
  },
];
