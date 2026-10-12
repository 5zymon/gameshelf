import { resolveTestDatabaseUrl } from './test-env';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATABASE_URL = resolveTestDatabaseUrl();
process.env.SESSION_SECRET ??= 'test-session-secret-0123456789abcdef0123456789';
process.env.SESSION_TTL_MINUTES ??= '120';
// The upload API refuses (503) unless an API key AND a base URL are available.
// The key comes from env here; specs that upload seed the base URL with
// `seedLlmSettings`.
process.env.CUSTOM_API_KEY ??= 'test-llm-key';
// Deterministic model resolution: a developer `.env` LLM_MODEL must not leak in.
process.env.LLM_MODEL = '';
process.env.LLM_SETTINGS_SECRET ??= 'test-llm-settings-secret-0123456789';
process.env.IMPORT_PHOTOS_DIR = join(tmpdir(), 'gameshelf-import-photos-e2e');
// Durable cover cache for the e2e tier (the pipeline writes here; the
// covers e2e spec serves files back from it).
process.env.COVERS_DIR = join(tmpdir(), 'gameshelf-covers-e2e');
// Deterministic IGDB-only boot: a developer `.env` with a MobyGames key must not
// register the fallback in the e2e tier.
process.env.MOBYGAMES_API_KEY = '';
