import {
  IMPORT_JOB_LEASE_MS,
  IMPORT_MAX_ATTEMPTS,
  IMPORT_QUEUE_POLL_INTERVAL_MS,
  IMPORT_RETRY_BACKOFF_MS,
  IMPORT_STALL_CHECK_INTERVAL_MS,
  IMPORT_WORKER_SHUTDOWN_GRACE_MS,
} from '../import-jobs/import-pipeline.options';

/** DI token: tests override it via createTestApp([{ provide, useValue }]). */
export const PHOTO_IMPORT_QUEUE_OPTIONS = Symbol('PHOTO_IMPORT_QUEUE_OPTIONS');

/** Timings and budget for the in-process MySQL-backed photo-import worker (ADR-005). */
export interface PhotoImportQueueOptions {
  /** Start polling on application bootstrap. Specs that only observe enqueueing pass false. */
  autoStart: boolean;
  pollIntervalMs: number;
  leaseMs: number;
  stallCheckIntervalMs: number;
  retryBackoffMs: number;
  maxAttempts: number;
  shutdownGraceMs: number;
}

/**
 * Worker options, applied once at module registration. `overrides` exists so
 * tests can shrink the timings; production never passes it.
 */
export function photoImportQueueOptions(
  overrides: Partial<PhotoImportQueueOptions> = {},
): PhotoImportQueueOptions {
  return {
    autoStart: true,
    pollIntervalMs: IMPORT_QUEUE_POLL_INTERVAL_MS,
    leaseMs: IMPORT_JOB_LEASE_MS,
    stallCheckIntervalMs: IMPORT_STALL_CHECK_INTERVAL_MS,
    retryBackoffMs: IMPORT_RETRY_BACKOFF_MS,
    maxAttempts: IMPORT_MAX_ATTEMPTS,
    shutdownGraceMs: IMPORT_WORKER_SHUTDOWN_GRACE_MS,
    ...overrides,
  };
}

/** Exponential backoff matching BullMQ's: base · 2^(attemptsMade − 1) → 5 s, 10 s. */
export function retryDelayMs(attemptsMade: number, baseMs: number): number {
  return baseMs * 2 ** Math.max(0, attemptsMade - 1);
}
