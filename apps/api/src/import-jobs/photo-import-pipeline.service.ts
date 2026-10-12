import { Injectable, Logger } from '@nestjs/common';
import { UnrecoverableError, type Job } from 'bullmq';
import { GameCatalogResolver } from '../game-catalog/game-catalog.resolver';
import type {
  ConfigErrorSource,
  PhotoImportJobData,
} from '../queue/photo-import.types';
import type { PhotoImportJobResult } from '../queue/photo-import.types';
import {
  ConfigurationImportError,
  configErrorSource,
  isRetryableImportError,
  RetryableImportError,
  photoImportFailureReason,
} from '../queue/photo-import.failure';
import { QueueControlService } from '../queue/queue-control.service';
import { VisionService } from '../settings/vision/vision.service';
import {
  IMPORT_BATCH_SIZE,
  IMPORT_JOB_TIMEOUT_MS,
  IMPORT_MIN_CONFIDENCE,
} from './import-pipeline.options';
import {
  ImportJobsService,
  toCandidateRecords,
  type ImportBatchOutcome,
  type JobCompletionResult,
  type PipelineJobState,
  type PipelineRecognizedItem,
} from './import-jobs.service';
import { PhotoStorageService } from './photo-storage.service';

/**
 * Stable, UI-translatable reason for a title that matched a catalog candidate
 * but had no usable platform name to resolve. Unknown platform names are
 * created by the import (spec §4.6.6), so this now only covers the case where
 * neither the raw platform nor any candidate name/abbreviation is usable —
 * the token itself is kept for compatibility with existing clients. The item
 * is still recorded as an `UnrecognizedItem` — it is surfaced for review,
 * never silently dropped.
 */
export const PLATFORM_NOT_IN_CATALOG_REASON = 'platform_not_in_catalog';

/** Outcome of one pipeline invocation, used only for the structured log line. */
export type PhotoImportOutcome =
  | 'done'
  | 'needs_attention'
  | 'already_terminal'
  | 'retry_scheduled'
  | 'failed';

/** A single structured per-job log entry (ticket 3.7). */
export interface PhotoImportOutcomeLog {
  jobId: string | number | undefined;
  importJobId: number | null;
  photoRef: string;
  outcome: PhotoImportOutcome;
  recognizedCount: number;
  importedCount: number;
  unrecognizedCount: number;
  durationMs: number;
  /**
   * Wall time of the single vision call this attempt made, recorded even when
   * the call throws (e.g. its own `timeout`). Omitted when no vision call ran
   * in this attempt (a retry that reuses `visionCompletedAt`).
   */
  visionDurationMs?: number;
  attempt: number;
  maxAttempts: number;
  error?: string;
}

/**
 * Per-attempt timings collected while the job runs, so the terminal log line
 * can separate the vision call from the whole job. `visionDurationMs` stays
 * unset when the attempt made no vision call (the marker already existed).
 */
interface PipelineTimings {
  visionDurationMs?: number;
}

/** Serializes the per-job outcome to one JSON log line (pure; unit-tested). */
export function formatImportJobOutcome(entry: PhotoImportOutcomeLog): string {
  return JSON.stringify({ event: 'photo_import_job', ...entry });
}

const EMPTY_COUNTS: JobCompletionResult = {
  recognizedCount: 0,
  importedCount: 0,
  unrecognizedCount: 0,
};

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
    private readonly queueControl: QueueControlService,
  ) {}

  async run(job: Job<PhotoImportJobData>): Promise<PhotoImportJobResult> {
    const startedAt = Date.now();
    let importJobId: number | null = job.data.importJobId ?? null;
    let outcome: PhotoImportOutcome = 'failed';
    let counts: JobCompletionResult = EMPTY_COUNTS;
    let errorMessage: string | undefined;
    const timings: PipelineTimings = {};
    try {
      const jobId =
        importJobId ?? (await this.jobs.findJobIdByPhotoRef(job.data.photoRef));
      if (jobId === null) {
        throw new RetryableImportError('Import job not found for this photo');
      }
      importJobId = jobId;
      const state = await this.jobs.getPipelineJob(jobId);
      if (state === null) {
        throw new RetryableImportError(`Import job ${String(jobId)} not found`);
      }
      if (TERMINAL_STATUSES.has(state.status)) {
        counts = toResult(state);
        outcome = 'already_terminal';
        return counts;
      }

      await this.jobs.markProcessing(jobId);
      const controller = new AbortController();
      try {
        const completed = await this.withJobTimeout(controller, () =>
          this.processJob(jobId, state, controller.signal, timings),
        );
        counts = completed.result;
        outcome = completed.status === 'done' ? 'done' : 'needs_attention';
        return completed.result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
        const retryable = isRetryableImportError(error);
        const configSource = configErrorSource(error);
        counts = (await this.summarizeSafely(jobId)) ?? counts;
        if (configSource !== null) {
          // Config error: fail the current photo, pause the queue, never retry.
          outcome = 'failed';
          await this.markFailedSafely(jobId, error, counts);
          await this.pauseForConfigErrorSafely(
            configSource,
            photoImportFailureReason(error),
          );
          throw new UnrecoverableError(message);
        }
        if (!retryable || isLastAttempt) {
          outcome = 'failed';
          await this.markFailedSafely(jobId, error, counts);
        } else {
          outcome = 'retry_scheduled';
        }
        if (!retryable) {
          // A permanent error must stop BullMQ immediately. Re-throwing the
          // ordinary error would schedule the remaining attempts; each would
          // re-enter, hit the `failed` short-circuit and report `completed`,
          // leaving BullMQ's job completed while the DB row is failed.
          throw new UnrecoverableError(message);
        }
        throw error;
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      this.logJobOutcome({
        jobId: job.id,
        importJobId,
        photoRef: job.data.photoRef,
        outcome,
        ...counts,
        durationMs: Date.now() - startedAt,
        visionDurationMs: timings.visionDurationMs,
        attempt: job.attemptsMade + 1,
        maxAttempts: job.opts.attempts ?? 1,
        error: errorMessage,
      });
    }
  }

  /** The one and only vision call for this job. */
  private async recognizeOnce(
    jobId: number,
    state: PipelineJobState,
    timings: PipelineTimings,
  ): Promise<void> {
    if (state.photoRef === null) {
      throw new RetryableImportError('Import job has no photo to process');
    }
    const { buffer, mimeType } = await this.storage.read(state.photoRef);
    const visionStartedAt = Date.now();
    // `.finally` records the wall time whether the provider answers or throws
    // (its own timeout/network error), which is exactly the case worth seeing.
    const recognition = await this.vision
      .recognize({
        image: buffer,
        mimeType,
      })
      .finally(() => {
        timings.visionDurationMs = Date.now() - visionStartedAt;
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
  private async processBatches(
    jobId: number,
    signal: AbortSignal,
  ): Promise<boolean> {
    for (;;) {
      this.throwIfAborted(signal);
      const pending = await this.jobs.listPendingRecognizedItems(jobId);
      if (pending.length === 0) {
        return false;
      }
      const batch = pending.slice(0, IMPORT_BATCH_SIZE);
      const outcome = await this.resolveBatch(batch, signal);
      // The timeout may have fired while the batch was resolving: skip the
      // commit so an abandoned attempt cannot write after the boundary.
      this.throwIfAborted(signal);
      await this.jobs.commitImportBatch(jobId, outcome);
      if (outcome.transient.length > 0) {
        return true;
      }
    }
  }

  private async resolveBatch(
    batch: PipelineRecognizedItem[],
    signal: AbortSignal,
  ): Promise<ImportBatchOutcome> {
    const outcome: ImportBatchOutcome = {
      resolved: [],
      unrecognized: [],
      transient: [],
    };
    for (const item of batch) {
      // One external lookup at a time: stop before starting another once the
      // attempt was cancelled.
      this.throwIfAborted(signal);
      const resolution = await this.resolver.resolve({
        title: item.rawTitle,
        edition: item.rawEdition,
        platform: item.rawPlatform,
        confidence: item.confidence,
      });
      if (resolution.kind === 'config_error') {
        // Configuration error (rejected/absent credentials): stop the job and
        // let the caller pause the queue. Nothing from this batch is committed —
        // the still-pending titles are re-resolved on a later retry, never
        // duplicated.
        throw new ConfigurationImportError(
          resolution.source,
          resolution.reason,
        );
      }
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
          rawEdition: item.rawEdition,
          candidates: toCandidateRecords(resolution.tiedCandidates),
          reason: resolution.reason,
        });
        continue;
      }
      const resolvedPlatform = await this.jobs.resolvePlatformId(
        resolution.candidate.platforms,
        item.rawPlatform,
      );
      if (resolvedPlatform === null) {
        outcome.unrecognized.push({
          recognizedItemId: item.id,
          rawTitle: item.rawTitle,
          rawPlatform: item.rawPlatform,
          rawEdition: item.rawEdition,
          candidates: null,
          reason: PLATFORM_NOT_IN_CATALOG_REASON,
        });
        continue;
      }
      outcome.resolved.push({
        recognizedItemId: item.id,
        platformId: resolvedPlatform.platformId,
        platformUnverified: resolvedPlatform.provenance === 'catalog',
        edition: item.rawEdition,
        candidate: resolution.candidate,
      });
    }
    return outcome;
  }

  /** The bounded unit of work: vision (once) + batched resolution + completion. */
  private async processJob(
    jobId: number,
    state: PipelineJobState,
    signal: AbortSignal,
    timings: PipelineTimings,
  ): Promise<{ result: PhotoImportJobResult; status: string }> {
    this.throwIfAborted(signal);
    if (state.visionCompletedAt === null) {
      await this.recognizeOnce(jobId, state, timings);
    }
    const transient = await this.processBatches(jobId, signal);
    if (transient) {
      throw new RetryableImportError(
        'Some titles could not be validated; retrying',
      );
    }
    // A cancelled attempt must not report completion either.
    this.throwIfAborted(signal);
    const result = await this.jobs.summarizeRecognizedItems(jobId);
    const completed = await this.jobs.markCompleted(jobId, result);
    await this.deletePhotoSafely(state.photoRef);
    return { result, status: completed.status };
  }

  /**
   * Fails the job with a retryable timeout once `jobTimeoutMs()` elapses and
   * aborts the controller so the abandoned work stops at the boundary. Without
   * the abort the in-flight pipeline would keep resolving and committing
   * batches while a retry (or the terminal `failed` marking) races it.
   */
  private async withJobTimeout<T>(
    controller: AbortController,
    work: () => Promise<T>,
  ): Promise<T> {
    const timeoutMs = this.jobTimeoutMs();
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        work(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(
              new RetryableImportError(
                `Photo import exceeded the ${String(timeoutMs)} ms job timeout`,
              ),
            );
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /**
   * Cancellation checkpoint: throws the same retryable error as the timeout so
   * the abandoned loop unwinds without committing another batch.
   */
  private throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new RetryableImportError(
        'Photo import was cancelled after exceeding the job timeout',
      );
    }
  }

  /** Test seam; production always returns IMPORT_JOB_TIMEOUT_MS. */
  protected jobTimeoutMs(): number {
    return IMPORT_JOB_TIMEOUT_MS;
  }

  private logJobOutcome(entry: PhotoImportOutcomeLog): void {
    const line = formatImportJobOutcome(entry);
    if (entry.outcome === 'failed' || entry.outcome === 'retry_scheduled') {
      this.logger.warn(line);
    } else {
      this.logger.log(line);
    }
  }

  private async summarizeSafely(
    jobId: number,
  ): Promise<JobCompletionResult | undefined> {
    try {
      return await this.jobs.summarizeRecognizedItems(jobId);
    } catch (error) {
      this.logger.warn(
        `Failed to summarise import job ${String(jobId)} counters: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return undefined;
    }
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

  /** Pauses the queue without masking the original config error. */
  private async pauseForConfigErrorSafely(
    source: ConfigErrorSource,
    reason: string,
  ): Promise<void> {
    try {
      await this.queueControl.pauseForConfig(source, reason);
    } catch (pauseError) {
      this.logger.error(
        `Failed to pause the photo-import queue after a ${source} configuration error: ${
          pauseError instanceof Error ? pauseError.message : String(pauseError)
        }`,
      );
    }
  }

  private async markFailedSafely(
    jobId: number,
    error: unknown,
    counts?: JobCompletionResult,
  ): Promise<void> {
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
