/** MobyGames v2 API base URL (card 4.5). */
export const MOBYGAMES_BASE_URL = 'https://api.mobygames.com/v2';
/** Games search path, appended to the base URL. */
export const MOBYGAMES_GAMES_PATH = '/games';
/** Candidates requested per title. */
export const MOBYGAMES_SEARCH_LIMIT = 10;
/** Documented `include` grammar (trailing dot pulls nested fields). */
export const MOBYGAMES_GAME_INCLUDE = 'id,title,genres.,platforms.,covers.';
/** Env var holding the MobyGames API key (query param, not a header). */
export const MOBYGAMES_API_KEY_ENV = 'MOBYGAMES_API_KEY';
/** Hard ceiling on one MobyGames HTTP request. */
export const MOBYGAMES_REQUEST_TIMEOUT_MS = 5000;

/** MobyGames allows at most 1 request per rolling second. */
export const MOBYGAMES_MAX_REQUESTS_PER_SECOND = 1;
/** Hard hourly budget: 720 requests per rolling hour. */
export const MOBYGAMES_MAX_REQUESTS_PER_HOUR = 720;
/** Rolling window for the per-second cap. */
export const MOBYGAMES_SECOND_WINDOW_MS = 1000;
/** Rolling window for the hourly cap. */
export const MOBYGAMES_HOUR_WINDOW_MS = 3_600_000;
/** Concurrent in-flight MobyGames requests across the whole process. */
export const MOBYGAMES_MAX_CONCURRENT_REQUESTS = 1;
