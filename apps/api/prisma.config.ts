import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

// The monorepo has a single .env at the repository root (see .env.example).
// A local apps/api/.env wins if one is ever added. Paths are resolved from
// the current working directory (npm workspace scripts run from apps/api).
loadEnv({ path: ['.env', '../../.env'], quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // `prisma generate` (run in the build step) needs no database, so do
    // NOT use the env() helper here — it throws for every CLI command when
    // the variable is missing (e.g. a clean clone before .env exists).
    url: process.env.DATABASE_URL ?? '',
    // Shadow DB is only needed for `prisma migrate dev` (local work).
    ...(process.env.DATABASE_SHADOW_URL
      ? { shadowDatabaseUrl: process.env.DATABASE_SHADOW_URL }
      : {}),
  },
});
