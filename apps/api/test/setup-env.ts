import { resolveTestDatabaseUrl } from './test-env';

process.env.DATABASE_URL = resolveTestDatabaseUrl();
