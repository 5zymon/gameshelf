import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import nextEnv from '@next/env';

// GameShelf keeps a single `.env` at the monorepo root. Next.js only reads
// env files from the app directory by default, so load the root one here
// before the config is evaluated.
const __dirname = dirname(fileURLToPath(import.meta.url));
nextEnv.loadEnvConfig(
  resolve(__dirname, '../..'),
  process.env.NODE_ENV !== 'production',
  undefined,
  // Next.js loads env files for the app directory *before* evaluating this
  // config. Force a reload so the root `.env` wins.
  true,
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
