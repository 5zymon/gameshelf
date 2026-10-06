import {
  IMPORT_JOB_LOCK_DURATION_MS,
  IMPORT_JOB_LOCK_RENEW_TIME_MS,
  IMPORT_JOB_MAX_STALLED_COUNT,
  IMPORT_JOB_STALLED_INTERVAL_MS,
  IMPORT_JOB_TIMEOUT_MS,
  IMPORT_MAX_ATTEMPTS,
  IMPORT_RETRY_BACKOFF_MS,
} from '../../src/import-jobs/import-pipeline.options';
import { PHOTO_IMPORT_CONCURRENCY } from '../../src/queue/queue.constants';
import {
  photoImportDefaultJobOptions,
  photoImportWorkerOptions,
} from '../../src/queue/queue.options';

describe('photo-import queue options (unit)', () => {
  it('defaults jobs to exponential backoff with the configured attempts', () => {
    expect(photoImportDefaultJobOptions()).toEqual({
      attempts: IMPORT_MAX_ATTEMPTS,
      backoff: { type: 'exponential', delay: IMPORT_RETRY_BACKOFF_MS },
    });
  });

  it('configures lock, stall and concurrency for the worker', () => {
    const options = photoImportWorkerOptions();

    expect(options.concurrency).toBe(PHOTO_IMPORT_CONCURRENCY);
    expect(options.lockDuration).toBe(IMPORT_JOB_LOCK_DURATION_MS);
    expect(options.lockRenewTime).toBe(IMPORT_JOB_LOCK_RENEW_TIME_MS);
    expect(options.stalledInterval).toBe(IMPORT_JOB_STALLED_INTERVAL_MS);
    expect(options.maxStalledCount).toBe(IMPORT_JOB_MAX_STALLED_COUNT);
  });

  it('keeps the lock alive past the whole job timeout', () => {
    const options = photoImportWorkerOptions();

    // A lock shorter than the permitted job would let a second worker pick the
    // job up mid-flight (duplicate processing).
    expect(options.lockDuration).toBeGreaterThan(IMPORT_JOB_TIMEOUT_MS);
    expect(options.lockRenewTime).toBeLessThan(IMPORT_JOB_LOCK_DURATION_MS);
  });

  it('lets tests shrink the timings without dropping the pinned concurrency', () => {
    const options = photoImportWorkerOptions({ lockDuration: 300 });

    expect(options.lockDuration).toBe(300);
    expect(options.concurrency).toBe(PHOTO_IMPORT_CONCURRENCY);
  });
});
