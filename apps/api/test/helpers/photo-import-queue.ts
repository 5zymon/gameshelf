import type { PhotoImportRun } from '../../src/queue/photo-import.types';
import {
  PHOTO_IMPORT_QUEUE_OPTIONS,
  photoImportQueueOptions,
  type PhotoImportQueueOptions,
} from '../../src/queue/queue.options';
import type { TestProviderOverride } from './test-app';

/**
 * A `PHOTO_IMPORT_QUEUE_OPTIONS` override for `createTestApp` (ADR-005). Specs
 * use it to shrink the worker's timings; production never overrides them.
 */
export function queueOptions(
  overrides: Partial<PhotoImportQueueOptions>,
): TestProviderOverride {
  return {
    provide: PHOTO_IMPORT_QUEUE_OPTIONS,
    useValue: photoImportQueueOptions(overrides),
  };
}

/**
 * Keeps the in-process worker from polling at all. Specs that only observe
 * enqueueing (or drive `PhotoImportQueue` directly) pass this so no real
 * attempt races them.
 */
export const NO_WORKER: TestProviderOverride = queueOptions({
  autoStart: false,
});

/**
 * One worker unit of work (ADR-005). Mirrors the old BullMQ `Job` positional
 * args: `attemptsMade` is the number of attempts already finished, so the
 * 1-based `attempt` is `attemptsMade + 1`.
 */
export function makeRun(
  importJobId: number,
  photoRef: string | null,
  attemptsMade = 0,
  maxAttempts = 3,
): PhotoImportRun {
  return {
    importJobId,
    photoRef,
    attempt: attemptsMade + 1,
    maxAttempts,
  };
}

/** Polls `predicate` until it is true or `timeoutMs` elapses. */
export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  stepMs = 25,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  throw new Error(`condition not met within ${String(timeoutMs)}ms`);
}
