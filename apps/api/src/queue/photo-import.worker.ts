import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { isTerminalImportJobStatus } from '../import-jobs/import-job-status';
import { ImportJobsService } from '../import-jobs/import-jobs.service';
import {
  PermanentImportError,
  photoImportFailureReason,
} from './photo-import.failure';
import { PhotoImportHandler } from './photo-import.handler';
import {
  PhotoImportQueue,
  type ClaimedPhotoImport,
} from './photo-import.queue';
import type { PhotoImportRun } from './photo-import.types';
import {
  PHOTO_IMPORT_CONCURRENCY,
  PHOTO_IMPORT_QUEUE,
} from './queue.constants';
import { QueueControlService } from './queue-control.service';
import {
  PHOTO_IMPORT_QUEUE_OPTIONS,
  retryDelayMs,
  type PhotoImportQueueOptions,
} from './queue.options';

/** Failure reason for a row whose lease expired after its attempt budget ran out. */
export const IMPORT_STALLED_FAILURE_REASON =
  'Photo import was interrupted and ran out of attempts';

/**
 * The single in-process photo-import worker (ADR-005).
 *
 * It polls `import_jobs` for a due `queued` row, claims it with
 * `FOR UPDATE SKIP LOCKED`, and runs it through `PhotoImportHandler` with
 * concurrency 1. It wakes immediately on an enqueue/resume and reclaims expired
 * leases on boot and every stall-check interval. A DB error is logged and
 * treated as "idle", so the poller never crashes the process.
 */
@Injectable()
export class PhotoImportWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(PhotoImportWorker.name);
  private running = false;
  private busy = false;
  private wakeRequested = false;
  private pollTimer?: NodeJS.Timeout;
  private stallTimer?: NodeJS.Timeout;
  private current: Promise<void> = Promise.resolve();
  private unsubscribe?: () => void;

  constructor(
    private readonly queue: PhotoImportQueue,
    private readonly handler: PhotoImportHandler,
    private readonly control: QueueControlService,
    private readonly jobs: ImportJobsService,
    @Inject(PHOTO_IMPORT_QUEUE_OPTIONS)
    private readonly options: PhotoImportQueueOptions,
  ) {}

  /** Worker liveness for GET /health/queue. */
  get isReady(): boolean {
    return this.running;
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.options.autoStart) {
      await this.start();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  /** Starts polling (idempotent). */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.unsubscribe = this.queue.onWake(() => {
      this.kick();
    });
    await this.recoverStalledSafely();
    this.stallTimer = setInterval(() => {
      void this.recoverStalledSafely();
    }, this.options.stallCheckIntervalMs);
    this.stallTimer.unref();
    this.pollTimer = setInterval(() => {
      this.kick();
    }, this.options.pollIntervalMs);
    this.pollTimer.unref();
    this.kick();
    this.logger.log(
      `Photo import worker ready (queue="${PHOTO_IMPORT_QUEUE}", concurrency=${String(PHOTO_IMPORT_CONCURRENCY)})`,
    );
  }

  /** Stops polling and waits up to the shutdown grace for the in-flight attempt. */
  async stop(): Promise<void> {
    this.running = false;
    if (this.pollTimer !== undefined) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    if (this.stallTimer !== undefined) {
      clearInterval(this.stallTimer);
      this.stallTimer = undefined;
    }
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.current,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, this.options.shutdownGraceMs);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /** Wakes the drain loop; a concurrent call only sets a flag (concurrency 1). */
  kick(): void {
    if (!this.running) return;
    if (this.busy) {
      this.wakeRequested = true;
      return;
    }
    this.busy = true;
    this.current = this.drain().finally(() => {
      this.busy = false;
    });
  }

  private async drain(): Promise<void> {
    while (this.running) {
      this.wakeRequested = false;
      const result = await this.processNext();
      if (result === 'processed') continue;
      if (this.hasPendingWake()) continue;
      return;
    }
  }

  /**
   * Reads the wake flag through a call: an enqueue/resume can set it while
   * `processNext` awaits, so a direct property read would be narrowed away.
   */
  private hasPendingWake(): boolean {
    return this.wakeRequested;
  }

  /**
   * Claims and runs at most one row (the unit-test seam). Returns `paused` when
   * the queue is paused, `idle` when nothing is due or a DB error happened, and
   * `processed` when one attempt ran.
   */
  async processNext(): Promise<'paused' | 'idle' | 'processed'> {
    try {
      if (await this.control.isPaused()) {
        return 'paused';
      }
    } catch (error) {
      this.logger.warn(
        `Could not read the photo-import pause state: ${describe(error)}`,
      );
      return 'idle';
    }

    let claimed: ClaimedPhotoImport | null;
    try {
      claimed = await this.queue.claimNext(this.options.leaseMs);
    } catch (error) {
      this.logger.warn(
        `Could not claim a photo-import job: ${describe(error)}`,
      );
      return 'idle';
    }
    if (claimed === null) {
      return 'idle';
    }

    const run: PhotoImportRun = {
      importJobId: claimed.id,
      photoRef: claimed.photoRef,
      attempt: claimed.attempts,
      maxAttempts: this.options.maxAttempts,
    };
    try {
      await this.handler.handle(run);
    } catch (error) {
      await this.settleFailure(claimed, error);
      return 'processed';
    }
    try {
      await this.queue.release(claimed.id);
    } catch (error) {
      this.logger.warn(
        `Could not release photo-import job ${String(claimed.id)}: ${describe(error)}`,
      );
      return 'idle';
    }
    return 'processed';
  }

  /** Decides retry vs terminal failure for one failed attempt. */
  private async settleFailure(
    job: ClaimedPhotoImport,
    error: unknown,
  ): Promise<void> {
    try {
      const permanent = error instanceof PermanentImportError;
      if (permanent || job.attempts >= this.options.maxAttempts) {
        const reason = photoImportFailureReason(
          permanent ? error.cause : error,
        );
        // Release only when the row really settled: if marking it failed threw
        // a DB error the lease must stay set, because a `processing` row with a
        // NULL lease is invisible to `findStalled` and would be stuck forever.
        if (await this.failSafely(job.id, reason)) {
          await this.queue.release(job.id);
          this.logger.warn(
            `Photo import job ${String(job.id)} failed ${
              permanent
                ? 'permanently'
                : `after ${String(job.attempts)} attempts`
            }: ${reason}`,
          );
        }
        return;
      }
      const delay = retryDelayMs(job.attempts, this.options.retryBackoffMs);
      await this.queue.scheduleRetry(job.id, delay);
      this.logger.warn(
        `Photo import job ${String(job.id)} attempt ${String(job.attempts)}/${String(
          this.options.maxAttempts,
        )} failed; retry in ${String(delay)} ms: ${describe(error)}`,
      );
    } catch (settleError) {
      this.logger.error(
        `Failed to settle photo-import job ${String(job.id)}: ${describe(settleError)}`,
      );
    }
  }

  /**
   * Marks a non-terminal row failed, swallowing the benign race exceptions.
   * Returns whether the row is settled: `true` when it was marked failed here
   * or is already terminal elsewhere, `false` when a non-conflict DB error left
   * it untouched. A `false` result tells the caller to keep the lease so the
   * stall-recovery path can reclaim the row later.
   */
  private async failSafely(id: number, reason: string): Promise<boolean> {
    try {
      const state = await this.jobs.getPipelineJob(id);
      if (state === null || isTerminalImportJobStatus(state.status)) {
        return true;
      }
      const counts = await this.jobs.summarizeRecognizedItems(id);
      await this.jobs.markFailed(id, reason, counts);
      return true;
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof NotFoundException
      ) {
        return true;
      }
      this.logger.warn(
        `Failed to mark photo-import job ${String(id)} failed: ${describe(error)}`,
      );
      return false;
    }
  }

  /**
   * Reclaims processing rows whose lease expired. A stalled attempt consumes an
   * attempt; once the budget is exhausted the row is failed.
   */
  async recoverStalled(): Promise<{ requeued: number; failed: number }> {
    const stalled = await this.queue.findStalled();
    let requeued = 0;
    let failed = 0;
    for (const row of stalled) {
      if (row.attempts >= this.options.maxAttempts) {
        // Settle (and only then drop the lease). If the fail-marking hit a DB
        // error the row keeps its expired lease, so the next pass re-selects it
        // instead of stranding a `processing` row with a NULL lease.
        if (await this.failSafely(row.id, IMPORT_STALLED_FAILURE_REASON)) {
          await this.queue.release(row.id);
          failed += 1;
          this.logger.warn(
            `Photo import job ${String(row.id)} was interrupted and ran out of attempts`,
          );
        }
        continue;
      }
      const requeuedRow = await this.queue.requeueStalled(
        row.id,
        retryDelayMs(row.attempts, this.options.retryBackoffMs),
      );
      if (requeuedRow) {
        requeued += 1;
        this.logger.warn(
          `Photo import job ${String(row.id)} was interrupted; re-queued (attempt ${String(
            row.attempts,
          )}/${String(this.options.maxAttempts)})`,
        );
      }
    }
    return { requeued, failed };
  }

  private async recoverStalledSafely(): Promise<void> {
    try {
      await this.recoverStalled();
    } catch (error) {
      this.logger.warn(
        `Could not reclaim stalled photo-import jobs: ${describe(error)}`,
      );
    }
  }
}

/** Renders an unknown thrown value as a message string. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
