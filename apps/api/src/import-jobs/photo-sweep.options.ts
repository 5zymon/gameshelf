/**
 * Photo sweep policy (ticket 3.8). Compile-time constants, deliberately not
 * env-driven — same convention as SESSION_CLEANUP_INTERVAL_MS (auth.config.ts).
 * Decision #4: photos are ephemeral. ADR-005: the photo is deleted only once
 * the job completes, never at first save.
 */

/** One sweep pass per hour. */
export const PHOTO_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** Max files examined per pass; the rest are handled on the next pass. */
export const PHOTO_SWEEP_BATCH_SIZE = 500;

/** A file with no owning import_jobs row is removed only once at least this old. */
export const PHOTO_SWEEP_ORPHAN_GRACE_MS = 60 * 60 * 1000; // 1 hour

/** A `failed` job keeps its photo (retryable) this long, then the sweep removes it. */
export const PHOTO_SWEEP_FAILED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * A queued/processing job with no queue or worker activity this long is
 * abandoned. Age is measured from `enqueuedAt` — the last upload/retry enqueue
 * or `markProcessing` start — not `createdAt`, so a job retried inside the
 * 7-day failed window is never swept. Legacy rows without a stamp fall back to
 * `createdAt`.
 */
export const PHOTO_SWEEP_STUCK_JOB_MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48 hours

/** errorMessage written when the sweep fails an abandoned queued/processing job. */
export const PHOTO_SWEEP_ABANDONED_REASON =
  'Photo import abandoned: no queue activity within the retention window';

/** Terminal statuses whose photo is already expected to be gone. */
export const PHOTO_SWEEPABLE_TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'done',
  'needs_attention',
  'dismissed',
]);

/** The job columns the sweep needs (newest row wins per photoRef). */
export interface PhotoSweepOwner {
  id: string;
  status: string;
  createdAt: Date;
  /** Last enqueue/start; null on legacy rows (falls back to `createdAt`). */
  enqueuedAt: Date | null;
  completedAt: Date | null;
}

export interface PhotoSweepDecision {
  action: 'delete' | 'keep';
  reason: string;
  /** True only for an abandoned non-terminal job: the sweep also fails the row. */
  markFailed: boolean;
}

/** Pure policy: should this file be removed now? Unit-tested. */
export function decidePhotoSweep(args: {
  fileAgeMs: number;
  owner: PhotoSweepOwner | null;
  now: Date;
}): PhotoSweepDecision {
  const { fileAgeMs, owner, now } = args;
  if (owner === null) {
    return fileAgeMs >= PHOTO_SWEEP_ORPHAN_GRACE_MS
      ? { action: 'delete', reason: 'orphan_no_job', markFailed: false }
      : { action: 'keep', reason: 'orphan_within_grace', markFailed: false };
  }
  if (PHOTO_SWEEPABLE_TERMINAL_STATUSES.has(owner.status)) {
    return {
      action: 'delete',
      reason: 'terminal_photo_leftover',
      markFailed: false,
    };
  }
  if (owner.status === 'failed') {
    const age =
      now.getTime() - (owner.completedAt ?? owner.createdAt).getTime();
    return age >= PHOTO_SWEEP_FAILED_RETENTION_MS
      ? { action: 'delete', reason: 'failed_past_retention', markFailed: false }
      : { action: 'keep', reason: 'failed_retryable', markFailed: false };
  }
  if (owner.status === 'queued' || owner.status === 'processing') {
    // Anchor on the last enqueue/start, not creation: a retry resets this, so
    // a job retried inside the 7-day window is never mistaken for abandoned.
    const age = now.getTime() - (owner.enqueuedAt ?? owner.createdAt).getTime();
    return age >= PHOTO_SWEEP_STUCK_JOB_MAX_AGE_MS
      ? { action: 'delete', reason: 'abandoned_non_terminal', markFailed: true }
      : { action: 'keep', reason: 'in_flight', markFailed: false };
  }
  return { action: 'keep', reason: 'unknown_status', markFailed: false };
}
