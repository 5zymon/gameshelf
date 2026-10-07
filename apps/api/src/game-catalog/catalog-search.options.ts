/** Below this many normalized characters the API returns [] without any upstream call. */
export const CATALOG_SEARCH_MIN_QUERY_LENGTH = 2;
/** Successful results (incl. empty) are cached this long to absorb keystrokes. */
export const CATALOG_SEARCH_CACHE_TTL_MS = 60_000;
/** Ranked candidates returned per search. */
export const CATALOG_SEARCH_MAX_RESULTS = 10;
/** Bounded cache size; oldest key evicted. */
export const CATALOG_SEARCH_MAX_CACHE_ENTRIES = 100;
