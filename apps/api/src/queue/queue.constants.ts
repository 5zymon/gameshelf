/**
 * Photo-import queue identifiers and pinned worker options.
 *
 * ADR-005 (MySQL-backed photo-import queue): the queue's unit of work is the
 * photo, and photos are processed one at a time.
 */

/** ADR-005: "One photo-import queue" — `import_jobs` itself. */
export const PHOTO_IMPORT_QUEUE = 'photo-import';

/**
 * ADR-005: queue concurrency is pinned to 1.
 *
 * Sequential processing is the design, not a tuning knob — IGDB allows 4 req/s
 * and MobyGames 1 req/s, so parallel photos would exceed the limits by
 * construction. Raising this value REQUIRES a new ADR superseding ADR-005.
 */
export const PHOTO_IMPORT_CONCURRENCY = 1 as const;
