import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ImportJobsService } from './import-jobs.service';
import { PhotoStorageService } from './photo-storage.service';
import {
  PHOTO_SWEEP_ABANDONED_REASON,
  PHOTO_SWEEP_BATCH_SIZE,
  PHOTO_SWEEP_INTERVAL_MS,
  decidePhotoSweep,
} from './photo-sweep.options';

/**
 * Backstop for the ephemeral photo lifecycle (ticket 3.8). The pipeline deletes
 * a photo when its job completes; this sweep removes what is left behind:
 * no-row orphans, terminal leftovers, dismissed jobs, abandoned queued/
 * processing jobs, and failed jobs past the retry window. It never touches a
 * photo that a queued/processing/failed-retryable job may still need.
 */
@Injectable()
export class PhotoSweepService {
  private readonly logger = new Logger(PhotoSweepService.name);

  constructor(
    private readonly jobs: ImportJobsService,
    private readonly storage: PhotoStorageService,
  ) {}

  /** Exposed without the decorator side-effect so tests can call it directly. */
  @Interval(PHOTO_SWEEP_INTERVAL_MS)
  async sweep(now: Date = new Date()): Promise<void> {
    try {
      const files = await this.storage.list();
      if (files.length === 0) return;
      const batch = files.slice(0, PHOTO_SWEEP_BATCH_SIZE);
      const owners = await this.jobs.findPhotoOwners(batch.map((f) => f.name));
      let deleted = 0;
      let failed = 0;
      for (const file of batch) {
        const owner = owners.get(file.name) ?? null;
        const decision = decidePhotoSweep({
          fileAgeMs: now.getTime() - file.mtimeMs,
          owner,
          now,
        });
        if (decision.action !== 'delete') continue;
        if (owner !== null) {
          const claimed = await this.jobs.releaseSweptPhoto(
            owner.id,
            file.name,
            owner.status,
            decision.markFailed ? PHOTO_SWEEP_ABANDONED_REASON : undefined,
          );
          // Row moved on (e.g. the user retried it): leave the file for that run.
          if (!claimed) continue;
          if (decision.markFailed) failed += 1;
        }
        try {
          await this.storage.delete(file.name);
          deleted += 1;
        } catch (error) {
          this.logger.warn(
            `Failed to delete swept photo "${file.name}": ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
      if (deleted > 0 || failed > 0) {
        this.logger.log(
          `Photo sweep: removed ${String(deleted)} photo(s), failed ${String(failed)} abandoned job(s)`,
        );
      }
    } catch (error) {
      this.logger.error(
        'Photo sweep failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
