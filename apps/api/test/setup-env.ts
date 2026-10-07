import { resolveTestDatabaseUrl } from './test-env';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
// The upload API refuses (503) without an LLM provider key, and writes to an
// ephemeral directory — give the e2e tier both so it exercises the happy path.
// The active default provider is Gemini; its key is what gates uploads.
process.env.GEMINI_API_KEY ??= 'test-llm-key';
process.env.OPENAI_API_KEY ??= 'test-llm-key';
process.env.LLM_SETTINGS_SECRET ??= 'test-llm-settings-secret-0123456789';
process.env.IMPORT_PHOTOS_DIR = join(tmpdir(), 'gameshelf-import-photos-e2e');
// Durable cover cache for the e2e tier (the pipeline writes here; the
// covers e2e spec serves files back from it).
process.env.COVERS_DIR = join(tmpdir(), 'gameshelf-covers-e2e');
// Deterministic IGDB-only boot: a developer `.env` with a MobyGames key must not
// register the fallback in the e2e tier.
process.env.MOBYGAMES_API_KEY = '';
