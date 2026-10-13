import {
  PHOTO_SWEEP_ABANDONED_REASON,
  PHOTO_SWEEP_BATCH_SIZE,
  PHOTO_SWEEP_FAILED_RETENTION_MS,
  PHOTO_SWEEP_INTERVAL_MS,
  PHOTO_SWEEP_ORPHAN_GRACE_MS,
  PHOTO_SWEEP_STUCK_JOB_MAX_AGE_MS,
  PHOTO_SWEEPABLE_TERMINAL_STATUSES,
  decidePhotoSweep,
  type PhotoSweepOwner,
} from '../../src/import-jobs/photo-sweep.options';
import { testId } from '../helpers/ids';

const NOW = new Date('2026-10-06T12:00:00.000Z');

function owner(overrides: Partial<PhotoSweepOwner> = {}): PhotoSweepOwner {
  return {
    id: testId(1),
    status: 'queued',
    createdAt: NOW,
    enqueuedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function ageOf(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

describe('photo sweep options', () => {
  it('exports the documented compile-time constants', () => {
    expect(PHOTO_SWEEP_INTERVAL_MS).toBe(60 * 60 * 1000);
    expect(PHOTO_SWEEP_BATCH_SIZE).toBe(500);
    expect(PHOTO_SWEEP_ORPHAN_GRACE_MS).toBe(60 * 60 * 1000);
    expect(PHOTO_SWEEP_FAILED_RETENTION_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(PHOTO_SWEEP_STUCK_JOB_MAX_AGE_MS).toBe(48 * 60 * 60 * 1000);
    expect(PHOTO_SWEEP_ABANDONED_REASON).toBe(
      'Photo import abandoned: no queue activity within the retention window',
    );
    expect(PHOTO_SWEEPABLE_TERMINAL_STATUSES).toEqual(
      new Set(['done', 'needs_attention', 'dismissed']),
    );
  });

  describe('decidePhotoSweep', () => {
    it('keeps a no-owner file within the orphan grace window', () => {
      expect(
        decidePhotoSweep({
          fileAgeMs: PHOTO_SWEEP_ORPHAN_GRACE_MS - 1,
          owner: null,
          now: NOW,
        }),
      ).toEqual({
        action: 'keep',
        reason: 'orphan_within_grace',
        markFailed: false,
      });
    });

    it('deletes a no-owner file at the orphan grace threshold', () => {
      expect(
        decidePhotoSweep({
          fileAgeMs: PHOTO_SWEEP_ORPHAN_GRACE_MS,
          owner: null,
          now: NOW,
        }),
      ).toEqual({
        action: 'delete',
        reason: 'orphan_no_job',
        markFailed: false,
      });
    });

    it.each(['done', 'needs_attention', 'dismissed'])(
      'deletes a photo left by a %s job',
      (status) => {
        expect(
          decidePhotoSweep({
            fileAgeMs: 0,
            owner: owner({ status }),
            now: NOW,
          }),
        ).toEqual({
          action: 'delete',
          reason: 'terminal_photo_leftover',
          markFailed: false,
        });
      },
    );

    it('keeps a failed job photo within the retention window', () => {
      expect(
        decidePhotoSweep({
          fileAgeMs: 0,
          owner: owner({
            status: 'failed',
            completedAt: ageOf(PHOTO_SWEEP_FAILED_RETENTION_MS - 1),
          }),
          now: NOW,
        }),
      ).toEqual({
        action: 'keep',
        reason: 'failed_retryable',
        markFailed: false,
      });
    });

    it('deletes a failed job photo at the retention threshold', () => {
      expect(
        decidePhotoSweep({
          fileAgeMs: 0,
          owner: owner({
            status: 'failed',
            completedAt: ageOf(PHOTO_SWEEP_FAILED_RETENTION_MS),
          }),
          now: NOW,
        }),
      ).toEqual({
        action: 'delete',
        reason: 'failed_past_retention',
        markFailed: false,
      });
    });

    it('falls back to createdAt when a failed job has no completedAt', () => {
      expect(
        decidePhotoSweep({
          fileAgeMs: 0,
          owner: owner({
            status: 'failed',
            createdAt: ageOf(PHOTO_SWEEP_FAILED_RETENTION_MS),
            completedAt: null,
          }),
          now: NOW,
        }),
      ).toEqual({
        action: 'delete',
        reason: 'failed_past_retention',
        markFailed: false,
      });
    });

    it.each(['queued', 'processing'])(
      'keeps an in-flight %s job photo before the abandonment window',
      (status) => {
        expect(
          decidePhotoSweep({
            fileAgeMs: 0,
            owner: owner({
              status,
              createdAt: ageOf(PHOTO_SWEEP_STUCK_JOB_MAX_AGE_MS - 1),
            }),
            now: NOW,
          }),
        ).toEqual({
          action: 'keep',
          reason: 'in_flight',
          markFailed: false,
        });
      },
    );

    it.each(['queued', 'processing'])(
      'deletes and fails an abandoned %s job photo at the abandonment window',
      (status) => {
        expect(
          decidePhotoSweep({
            fileAgeMs: 0,
            owner: owner({
              status,
              createdAt: ageOf(PHOTO_SWEEP_STUCK_JOB_MAX_AGE_MS),
            }),
            now: NOW,
          }),
        ).toEqual({
          action: 'delete',
          reason: 'abandoned_non_terminal',
          markFailed: true,
        });
      },
    );

    it.each(['queued', 'processing'])(
      'keeps a %s job retried inside the window even when createdAt is far older',
      (status) => {
        expect(
          decidePhotoSweep({
            fileAgeMs: 0,
            owner: owner({
              status,
              // Created 6 days ago, but the run was re-enqueued an hour ago.
              createdAt: ageOf(6 * 24 * 60 * 60 * 1000),
              enqueuedAt: ageOf(60 * 60 * 1000),
            }),
            now: NOW,
          }),
        ).toEqual({
          action: 'keep',
          reason: 'in_flight',
          markFailed: false,
        });
      },
    );

    it.each(['queued', 'processing'])(
      'deletes and fails a %s job idle past the window since its last enqueue',
      (status) => {
        expect(
          decidePhotoSweep({
            fileAgeMs: 0,
            owner: owner({
              status,
              // Recent creation must not mask a stale last-activity stamp.
              createdAt: ageOf(60 * 60 * 1000),
              enqueuedAt: ageOf(PHOTO_SWEEP_STUCK_JOB_MAX_AGE_MS),
            }),
            now: NOW,
          }),
        ).toEqual({
          action: 'delete',
          reason: 'abandoned_non_terminal',
          markFailed: true,
        });
      },
    );

    it('keeps a photo owned by an unknown status', () => {
      expect(
        decidePhotoSweep({
          fileAgeMs: 0,
          owner: owner({ status: 'mystery' }),
          now: NOW,
        }),
      ).toEqual({
        action: 'keep',
        reason: 'unknown_status',
        markFailed: false,
      });
    });
  });
});
