import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import nextEnv from '@next/env';
import createNextIntlPlugin from 'next-intl/plugin';

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

// A blank API_PORT means 3001, matching apps/api/src/listen-address.ts.
const rawApiPort = process.env.API_PORT?.trim();
const apiPort =
  rawApiPort === undefined || rawApiPort === '' ? '3001' : rawApiPort;

// Server-side target of the `/api` rewrite (and of SSR in `lib/api/server.ts`).
// A blank NEXT_PUBLIC_API_URL derives the origin from the API port; this is
// never a browser URL: the browser only ever calls the web origin.
const rawApiOrigin = process.env.NEXT_PUBLIC_API_URL?.trim();
const apiOrigin = (
  rawApiOrigin === undefined || rawApiOrigin === ''
    ? `http://localhost:${apiPort}`
    : rawApiOrigin
).replace(/\/+$/, '');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@gameshelf/contracts'],
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiOrigin}/:path*` }];
  },
};

// Links `src/i18n/request.ts` to next-intl so Server Components can resolve the
// locale (from the NEXT_LOCALE cookie) and load the matching message catalog.
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default withNextIntl(nextConfig);
