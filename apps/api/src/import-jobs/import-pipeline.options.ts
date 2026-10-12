/**
 * Tuning constants for the photo import pipeline (ticket 3.5).
 *
 * `IMPORT_BATCH_SIZE` is deliberately small (10, not 20): a typical photo
 * recognizes more than ten games, so it spans several batches and each batch
 * commits in its own MySQL transaction — a mid-job kill leaves the earlier
 * batches persisted (acceptance criterion).
 */
export const IMPORT_BATCH_SIZE = 10;

/** Queue attempts: one initial run plus two retries. */
export const IMPORT_MAX_ATTEMPTS = 3;

/** Exponential backoff base between attempts. */
export const IMPORT_RETRY_BACKOFF_MS = 5000;

/**
 * Minimum model confidence to even consider an item. 0 keeps every item the
 * model reported (the vision layer already filters non-games upstream).
 */
export const IMPORT_MIN_CONFIDENCE = 0;

/** Per-IGDB-request timeout. */
export const IGDB_REQUEST_TIMEOUT_MS = 5000;

/**
 * Hard ceiling on one photo-import job (ticket 3.7): one vision call
 * (`VISION_REQUEST_TIMEOUT_MS = 120 s`) plus the per-title IGDB lookups. Since
 * ticket 4.1 those lookups go through one central rate limiter (4 req/s, 8
 * concurrent), which paces requests beyond the window (≈250 ms each in the
 * worst case), and each request has an `IGDB_REQUEST_TIMEOUT_MS` (5 s) ceiling. IGDB 429s are retried
 * internally up to `IGDB_MAX_ATTEMPTS = 3` with exponential backoff (base
 * 500 ms, cap 5 s), while timeouts/5xx/network failures remain the queue's
 * responsibility (worker retry). A realistic shelf (≤ ~50 titles) worst-cases
 * at ~120 s + 50 × (5 s + 250 ms limiter pacing) ≈ 383 s; 420 s bounds it with
 * headroom. A job that exceeds this is treated as transient and retried.
 */
export const IMPORT_JOB_TIMEOUT_MS = 420_000;

/**
 * Lease lifetime for one photo-import attempt (ADR-005). MUST exceed
 * `IMPORT_JOB_TIMEOUT_MS`: a lease shorter than the job would let the stall
 * recovery re-queue the row while the first attempt still runs (duplicate
 * processing). 480 s > the 420 s timeout. No renewal.
 */
export const IMPORT_JOB_LEASE_MS = 480_000;

/** How often the worker reclaims processing rows whose lease expired. */
export const IMPORT_STALL_CHECK_INTERVAL_MS = 30_000;

/** How often the in-process worker polls for a due `queued` row. */
export const IMPORT_QUEUE_POLL_INTERVAL_MS = 1_000;

/**
 * How long shutdown waits for the in-flight attempt before returning. The
 * attempt's lease stays set, so stall recovery reclaims it after the next boot.
 */
export const IMPORT_WORKER_SHUTDOWN_GRACE_MS = 5_000;
