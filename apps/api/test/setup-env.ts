import { resolveTestDatabaseUrl } from './test-env';

process.env.DATABASE_URL = resolveTestDatabaseUrl();
process.env.SESSION_SECRET ??= 'test-session-secret-0123456789abcdef0123456789';
process.env.SESSION_TTL_MINUTES ??= '120';
process.env.REDIS_HOST ??= 'localhost';
process.env.REDIS_PORT ??= '6379';
// Namespace the e2e queue's Redis keys so the suite neither reads nor wipes a
// developer's dev queue. `REDIS_QUEUE_PREFIX` defaults to BullMQ's `bull`; the
// e2e tier uses its own keyspace on the same Redis, so no dev server needs to
// be stopped.
process.env.REDIS_QUEUE_PREFIX = 'bull-e2e';
