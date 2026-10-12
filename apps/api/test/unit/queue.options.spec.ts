import {
  IMPORT_JOB_LEASE_MS,
  IMPORT_JOB_TIMEOUT_MS,
  IMPORT_MAX_ATTEMPTS,
  IMPORT_QUEUE_POLL_INTERVAL_MS,
  IMPORT_RETRY_BACKOFF_MS,
  IMPORT_STALL_CHECK_INTERVAL_MS,
  IMPORT_WORKER_SHUTDOWN_GRACE_MS,
} from '../../src/import-jobs/import-pipeline.options';
import {
  photoImportQueueOptions,
  retryDelayMs,
} from '../../src/queue/queue.options';

describe('photo-import queue options (unit)', () => {
  it('defaults to the pinned constants', () => {
    expect(photoImportQueueOptions()).toEqual({
      autoStart: true,
      pollIntervalMs: IMPORT_QUEUE_POLL_INTERVAL_MS,
      leaseMs: IMPORT_JOB_LEASE_MS,
      stallCheckIntervalMs: IMPORT_STALL_CHECK_INTERVAL_MS,
      retryBackoffMs: IMPORT_RETRY_BACKOFF_MS,
      maxAttempts: IMPORT_MAX_ATTEMPTS,
      shutdownGraceMs: IMPORT_WORKER_SHUTDOWN_GRACE_MS,
    });
    expect(IMPORT_QUEUE_POLL_INTERVAL_MS).toBe(1_000);
    expect(IMPORT_STALL_CHECK_INTERVAL_MS).toBe(30_000);
    expect(IMPORT_RETRY_BACKOFF_MS).toBe(5_000);
    expect(IMPORT_MAX_ATTEMPTS).toBe(3);
    expect(IMPORT_WORKER_SHUTDOWN_GRACE_MS).toBe(5_000);
  });

  it('keeps the lease alive past the whole job timeout', () => {
    // A lease shorter than the permitted job would let the stall recovery pick
    // the row up mid-flight (duplicate processing).
    expect(IMPORT_JOB_LEASE_MS).toBeGreaterThan(IMPORT_JOB_TIMEOUT_MS);
  });

  it('lets tests shrink the timings without dropping the other defaults', () => {
    const options = photoImportQueueOptions({
      autoStart: false,
      pollIntervalMs: 20,
      leaseMs: 300,
    });

    expect(options.autoStart).toBe(false);
    expect(options.pollIntervalMs).toBe(20);
    expect(options.leaseMs).toBe(300);
    expect(options.maxAttempts).toBe(IMPORT_MAX_ATTEMPTS);
  });

  it('computes exponential backoff base · 2^(attemptsMade − 1)', () => {
    expect(retryDelayMs(1, 5_000)).toBe(5_000);
    expect(retryDelayMs(2, 5_000)).toBe(10_000);
    expect(retryDelayMs(0, 5_000)).toBe(5_000);
  });
});
