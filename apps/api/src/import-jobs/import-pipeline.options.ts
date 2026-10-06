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

/** Per-IGDB-request timeout. */
export const IGDB_REQUEST_TIMEOUT_MS = 5000;

/**
 * How long the read API waits for BullMQ state (ticket 3.6) before falling
 * back to the durable MySQL status. Redis being slow/down must never hang a
 * read request.
 */
export const IMPORT_QUEUE_STATE_TIMEOUT_MS = 2_000;

/**
 * Hard ceiling on one photo-import job (ticket 3.7): one vision call
 * (`VISION_REQUEST_TIMEOUT_MS = 30 s`) plus the per-title IGDB lookups. Since
 * ticket 4.1 those lookups go through one central rate limiter (4 req/s, 8
 * concurrent), which paces requests beyond the window (≈250 ms each in the
 * worst case), and each request has an `IGDB_REQUEST_TIMEOUT_MS` (5 s) ceiling. IGDB 429s are retried
 * internally up to `IGDB_MAX_ATTEMPTS = 3` with exponential backoff (base
 * 500 ms, cap 5 s), while timeouts/5xx/network failures remain BullMQ's
 * responsibility. A realistic shelf (≤ ~50 titles) worst-cases at
 * ~30 s + 50 × (5 s + 250 ms limiter pacing) ≈ 295 s; 300 s bounds it with
 * headroom. A job that exceeds this is treated as transient and retried.
 */
export const IMPORT_JOB_TIMEOUT_MS = 300_000;

/**
 * BullMQ lock lifetime for one photo-import job (ticket 3.7). MUST exceed
 * `IMPORT_JOB_TIMEOUT_MS`: a lock shorter than the job would let a second
 * worker pick the job up while the first still runs (duplicate processing).
 * 360 s > the 300 s timeout.
 */
export const IMPORT_JOB_LOCK_DURATION_MS = 360_000;

/**
 * How often the live worker renews its lock. Default is half the lock
 * duration; kept explicit (180 s) and asserted `< lockDuration`.
 */
export const IMPORT_JOB_LOCK_RENEW_TIME_MS = 180_000;

/** How often the worker checks for stalled (lock-expired) jobs. */
export const IMPORT_JOB_STALLED_INTERVAL_MS = 30_000;

/**
 * Recoveries allowed before a job is failed: a killed worker's job is moved
 * back to `waiting` (and re-run) up to this many times, so a single crash is
 * recovered rather than left `active` forever.
 */
export const IMPORT_JOB_MAX_STALLED_COUNT = 2;
