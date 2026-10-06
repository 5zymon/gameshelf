/**
 * Tuning constants for the photo import pipeline (ticket 3.5).
 *
 * `IMPORT_BATCH_SIZE` is deliberately small (10, not 20): a typical photo
 * recognizes more than ten games, so it spans several batches and each batch
 * commits in its own MySQL transaction — a mid-job kill leaves the earlier
 * batches persisted (acceptance criterion).
 */
export const IMPORT_BATCH_SIZE = 10;

/** BullMQ `attempts`: one initial run plus two retries. */
export const IMPORT_MAX_ATTEMPTS = 3;

/** Exponential backoff base between BullMQ attempts. */
export const IMPORT_RETRY_BACKOFF_MS = 5000;

/**
 * Minimum model confidence to even consider an item. 0 keeps every item the
 * model reported (the vision layer already filters non-games upstream).
 */
export const IMPORT_MIN_CONFIDENCE = 0;

/** Minimum spacing between IGDB requests, to stay under the rate limit. */
export const IGDB_REQUEST_INTERVAL_MS = 300;

/** Per-IGDB-request timeout. */
export const IGDB_REQUEST_TIMEOUT_MS = 5000;

/**
 * How long the read API waits for BullMQ state (ticket 3.6) before falling
 * back to the durable MySQL status. Redis being slow/down must never hang a
 * read request.
 */
export const IMPORT_QUEUE_STATE_TIMEOUT_MS = 2_000;
