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

// Server-side target of the `/api` rewrite (and of SSR in `lib/api.ts`). This
// is never a browser URL: the browser only ever calls the web origin.
const apiOrigin = (
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
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
