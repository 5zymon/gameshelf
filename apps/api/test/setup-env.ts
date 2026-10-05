import { resolveTestDatabaseUrl } from './test-env';

process.env.DATABASE_URL = resolveTestDatabaseUrl();
process.env.SESSION_SECRET ??= 'test-session-secret-0123456789abcdef0123456789';
process.env.SESSION_TTL_MINUTES ??= '120';
