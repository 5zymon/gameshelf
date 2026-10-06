import { Injectable, Logger } from '@nestjs/common';
import { UnrecoverableError, type Job } from 'bullmq';
import { GameCatalogResolver } from '../game-catalog/game-catalog.resolver';
import type { PhotoImportJobData } from '../queue/photo-import.types';
import type { PhotoImportJobResult } from '../queue/photo-import.types';
import {
  isRetryableImportError,
  RetryableImportError,
  photoImportFailureReason,
} from '../queue/photo-import.failure';
import { VisionService } from '../settings/vision/vision.service';
import {
  IMPORT_BATCH_SIZE,
  IMPORT_MIN_CONFIDENCE,
} from './import-pipeline.options';
import {
  ImportJobsService,
  type ImportBatchOutcome,
  type JobCompletionResult,
  type PipelineJobState,
  type PipelineRecognizedItem,
} from './import-jobs.service';
import { PhotoStorageService } from './photo-storage.service';

/**
 * Stable, UI-translatable reason for a title that matched a catalog candidate
 * but whose platform could not be mapped to a seeded `Platform` row. A fixed
 * snake_case token (the same idiom as the vision error codes) rather than
 * prose, so the UI can render a specific "platform not seeded" message and the
 * value stays stable across wording changes. The item is still recorded as an
 * `UnrecognizedItem` — it is surfaced for review, never silently dropped.
 */
export const PLATFORM_NOT_IN_CATALOG_REASON = 'platform_not_in_catalog';

/** Job statuses at which nothing more should be processed. */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'done',
  'needs_attention',
  'dismissed',
  'failed',
]);

/**
 * The real ADR-002 unit of work (ticket 3.5): recognises one photo, validates
 * each title against the external catalog, and saves confirmed games per
 * batch, incrementally and idempotently.
 *
 * Invariants (acceptance criteria):
 * - the vision provider is called **once** per job — the
 *   `visionCompletedAt` marker + a transaction make `saveRecognition`
 *   one-shot;
 * - each batch commits in its own transaction, so a mid-job kill leaves the
 *   earlier batches persisted;
 * - saving is keyed on the recognized-item `pending` status, so re-running a
 *   job never duplicates catalog rows;
 * - a transient external failure throws `RetryableImportError`, the row stays
 *   `processing`, and BullMQ retries only the still-pending titles;
 * - the photo is deleted only after `markCompleted` succeeds.
 */
@Injectable()
export class PhotoImportPipelineService {
  private readonly logger = new Logger(PhotoImportPipelineService.name);

  constructor(
    private readonly jobs: ImportJobsService,
    private readonly storage: PhotoStorageService,
    private readonly vision: VisionService,
    private readonly resolver: GameCatalogResolver,
  ) {}

  async run(job: Job<PhotoImportJobData>): Promise<PhotoImportJobResult> {
    const jobId =
      job.data.importJobId ??
      (await this.jobs.findJobIdByPhotoRef(job.data.photoRef));
    if (jobId === null) {
      throw new RetryableImportError('Import job not found for this photo');
    }
    const state = await this.jobs.getPipelineJob(jobId);
    if (state === null) {
      throw new RetryableImportError(`Import job ${String(jobId)} not found`);
    }
    if (TERMINAL_STATUSES.has(state.status)) {
      return toResult(state);
    }

    await this.jobs.markProcessing(jobId);
    try {
      if (state.visionCompletedAt === null) {
        await this.recognizeOnce(jobId, state);
      }

      const transient = await this.processBatches(jobId);
      if (transient) {
        throw new RetryableImportError(
          'Some titles could not be validated; retrying',
        );
      }

      const result = await this.jobs.summarizeRecognizedItems(jobId);
      await this.jobs.markCompleted(jobId, result);
      await this.deletePhotoSafely(state.photoRef);
      return result;
    } catch (error) {
      const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      const retryable = isRetryableImportError(error);
      if (!retryable || isLastAttempt) {
        await this.markFailedSafely(jobId, error);
      }
      if (!retryable) {
        // A permanent error must stop BullMQ immediately. Re-throwing the
        // ordinary error would schedule the remaining attempts; each would
        // re-enter, hit the `failed` short-circuit and report `completed`,
        // leaving BullMQ's job completed while the DB row is failed.
        throw new UnrecoverableError(
          error instanceof Error ? error.message : String(error),
        );
      }
      throw error;
    }
  }

  /** The one and only vision call for this job. */
  private async recognizeOnce(
    jobId: number,
    state: PipelineJobState,
  ): Promise<void> {
    if (state.photoRef === null) {
      throw new RetryableImportError('Import job has no photo to process');
    }
    const { buffer, mimeType } = await this.storage.read(state.photoRef);
    const recognition = await this.vision.recognize({
      image: buffer,
      mimeType,
    });
    const items = recognition.items.filter(
      (item) => item.confidence >= IMPORT_MIN_CONFIDENCE,
    );
    await this.jobs.saveRecognition(jobId, items);
  }

  /**
   * Resolves pending titles batch by batch. External lookups run **outside**
   * any transaction; each batch then commits in one transaction. Returns
   * `true` when a batch hit a transient failure (the remaining items stay
   * pending for the retry).
   */
  private async processBatches(jobId: number): Promise<boolean> {
    for (;;) {
      const pending = await this.jobs.listPendingRecognizedItems(jobId);
      if (pending.length === 0) {
        return false;
      }
      const batch = pending.slice(0, IMPORT_BATCH_SIZE);
      const outcome = await this.resolveBatch(batch);
      await this.jobs.commitImportBatch(jobId, outcome);
      if (outcome.transient.length > 0) {
        return true;
      }
    }
  }

  private async resolveBatch(
    batch: PipelineRecognizedItem[],
  ): Promise<ImportBatchOutcome> {
    const outcome: ImportBatchOutcome = {
      resolved: [],
      unrecognized: [],
      transient: [],
    };
    for (const item of batch) {
      const resolution = await this.resolver.resolve({
        title: item.rawTitle,
        edition: item.rawEdition,
        platform: item.rawPlatform,
        confidence: item.confidence,
      });
      if (resolution.kind === 'transient') {
        outcome.transient.push({
          recognizedItemId: item.id,
          reason: resolution.reason,
        });
        continue;
      }
      if (resolution.kind === 'unrecognized') {
        outcome.unrecognized.push({
          recognizedItemId: item.id,
          rawTitle: item.rawTitle,
          rawPlatform: item.rawPlatform,
          reason: resolution.reason,
        });
        continue;
      }
      const platformId = await this.jobs.resolvePlatformId(
        resolution.candidate.platforms,
        item.rawPlatform,
      );
      if (platformId === null) {
        outcome.unrecognized.push({
          recognizedItemId: item.id,
          rawTitle: item.rawTitle,
          rawPlatform: item.rawPlatform,
          reason: PLATFORM_NOT_IN_CATALOG_REASON,
        });
        continue;
      }
      outcome.resolved.push({
        recognizedItemId: item.id,
        platformId,
        edition: item.rawEdition,
        candidate: resolution.candidate,
      });
    }
    return outcome;
  }

  private async deletePhotoSafely(photoRef: string | null): Promise<void> {
    try {
      await this.storage.delete(photoRef);
    } catch (error) {
      // The job is already complete; a failed cleanup must not fail it.
      this.logger.warn(
        `Failed to delete photo "${photoRef ?? ''}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async markFailedSafely(jobId: number, error: unknown): Promise<void> {
    let counts: JobCompletionResult | undefined;
    try {
      counts = await this.jobs.summarizeRecognizedItems(jobId);
    } catch (summaryError) {
      // Counters are best-effort; the failure itself must still be recorded.
      this.logger.warn(
        `Failed to summarise import job ${String(jobId)} counters: ${
          summaryError instanceof Error
            ? summaryError.message
            : String(summaryError)
        }`,
      );
    }
    try {
      await this.jobs.markFailed(
        jobId,
        photoImportFailureReason(error),
        counts,
      );
    } catch (markError) {
      // Never mask the original failure (e.g. the job turned terminal).
      this.logger.warn(
        `Failed to mark import job ${String(jobId)} failed: ${
          markError instanceof Error ? markError.message : String(markError)
        }`,
      );
    }
  }
}

/** Persists the counts already stored on a terminal job (idempotent re-run). */
function toResult(state: PipelineJobState): PhotoImportJobResult {
  return {
    recognizedCount: state.recognizedCount,
    importedCount: state.importedCount,
    unrecognizedCount: state.unrecognizedCount,
  };
}
