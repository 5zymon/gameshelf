/**
 * BullMQ identifiers and pinned worker options for the photo import.
 *
 * ADR-002 (BullMQ + Redis for the import queue): the queue's unit of work is
 * the photo, and photos are processed one at a time.
 */

/** ADR-002: "One BullMQ queue". */
export const PHOTO_IMPORT_QUEUE = 'photo-import';

/**
 * ADR-002: queue concurrency is pinned to 1.
 *
 * Sequential processing is the design, not a tuning knob — IGDB allows 4 req/s
 * and MobyGames 1 req/s, so parallel photos would exceed the limits by
 * construction. Raising this value REQUIRES a new ADR superseding ADR-002.
 */
export const PHOTO_IMPORT_CONCURRENCY = 1 as const;
