/** Central IGDB rate limit (ticket 4.1): 4 requests per rolling second. */
export const IGDB_MAX_REQUESTS_PER_SECOND = 4;
/** Concurrent in-flight IGDB requests across the whole process. */
export const IGDB_MAX_CONCURRENT_REQUESTS = 8;
/** Rolling window for the per-second cap. */
export const IGDB_RATE_WINDOW_MS = 1000;
/**
 * Cap on tasks waiting for a slot. Bounds memory when the health probe/imports
 * outpace the 4/s drain: instead of growing without limit, a task beyond this
 * many queued is rejected fast.
 */
export const IGDB_MAX_QUEUED_REQUESTS = 100;

/** Internal 429 retry: initial attempt + 2 retries. */
export const IGDB_MAX_ATTEMPTS = 3;
/** Exponential backoff base (attempt 1 -> 500 ms, attempt 2 -> 1000 ms). */
export const IGDB_RETRY_BASE_DELAY_MS = 500;
/** Cap for computed backoff and for an honored Retry-After. */
export const IGDB_RETRY_MAX_DELAY_MS = 5000;
/** Random jitter added to computed backoff (never to Retry-After). */
export const IGDB_RETRY_JITTER_MS = 250;

/** IGDB multiquery cap: at most 10 sub-queries per HTTP request (docs). */
export const IGDB_MULTIQUERY_MAX_QUERIES = 10;
/** Candidates requested per title in search and multiquery. */
export const IGDB_SEARCH_LIMIT = 10;
/** IGDB games endpoint hard cap: max rows per hydration request. */
export const IGDB_HYDRATION_MAX_IDS = 500;

/** IGDB image size segment for covers and gallery images (high quality). */
export const IGDB_IMAGE_SIZE = 't_1080p';
/** Max gallery images persisted per game (artworks, then screenshots). */
export const IGDB_GALLERY_MAX_IMAGES = 8;

/** Optional override of the OAuth token endpoint. */
export const IGDB_TOKEN_URL_ENV = 'IGDB_TOKEN_URL';
/** Canonical Twitch client-credentials endpoint (card 4.1). */
export const IGDB_TOKEN_URL_DEFAULT = 'https://id.twitch.tv/oauth2/token';
