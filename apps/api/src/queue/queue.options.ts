import type { DefaultJobOptions, WorkerOptions } from 'bullmq';
import {
  IMPORT_JOB_LOCK_DURATION_MS,
  IMPORT_JOB_LOCK_RENEW_TIME_MS,
  IMPORT_JOB_MAX_STALLED_COUNT,
  IMPORT_JOB_STALLED_INTERVAL_MS,
  IMPORT_MAX_ATTEMPTS,
  IMPORT_RETRY_BACKOFF_MS,
} from '../import-jobs/import-pipeline.options';
import { PHOTO_IMPORT_CONCURRENCY } from './queue.constants';

/**
 * Job options every photo import inherits (ticket 3.7), applied once via
 * `registerQueue`'s `defaultJobOptions` instead of per `add()` call.
 */
export function photoImportDefaultJobOptions(): DefaultJobOptions {
  return {
    attempts: IMPORT_MAX_ATTEMPTS,
    backoff: { type: 'exponential', delay: IMPORT_RETRY_BACKOFF_MS },
  };
}

/**
 * Worker options for the single photo-import worker (ticket 3.7).
 *
 * `lockDuration` deliberately exceeds `IMPORT_JOB_TIMEOUT_MS`, so a live job's
 * lock cannot expire mid-flight; a killed worker's lock therefore expires only
 * after the whole timeout has elapsed, and the stalled check re-queues it.
 *
 * `overrides` exists so tests can shrink the timings; production never passes
 * it. The return type omits `connection` because BullMQ 6 requires it on a raw
 * `Worker` but `@Processor` supplies it (Nest's worker-options parameter is
 * `Omit<WorkerOptions, 'connection'> & { connection?: ... }`).
 */
export function photoImportWorkerOptions(
  overrides: Partial<WorkerOptions> = {},
): Omit<WorkerOptions, 'connection'> {
  return {
    concurrency: PHOTO_IMPORT_CONCURRENCY,
    lockDuration: IMPORT_JOB_LOCK_DURATION_MS,
    lockRenewTime: IMPORT_JOB_LOCK_RENEW_TIME_MS,
    stalledInterval: IMPORT_JOB_STALLED_INTERVAL_MS,
    maxStalledCount: IMPORT_JOB_MAX_STALLED_COUNT,
    ...overrides,
  };
}
