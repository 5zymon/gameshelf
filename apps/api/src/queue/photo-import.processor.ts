import { BeforeApplicationShutdown, Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { PhotoImportHandler } from './photo-import.handler';
import {
  PHOTO_IMPORT_CONCURRENCY,
  PHOTO_IMPORT_QUEUE,
} from './queue.constants';
import type {
  PhotoImportJobData,
  PhotoImportJobResult,
} from './photo-import.types';

/**
 * The single photo-import worker.
 *
 * ADR-002: concurrency is pinned to 1 via PHOTO_IMPORT_CONCURRENCY; raising it
 * needs a new ADR (see queue.constants.ts). The worker starts with the Nest
 * application — QueueModule is imported by AppModule, so there is no manual
 * step. The worker MUST stay in this application: it shares the local photo
 * filesystem with the API (ADR-002).
 */
@Processor(PHOTO_IMPORT_QUEUE, { concurrency: PHOTO_IMPORT_CONCURRENCY })
export class PhotoImportProcessor
  extends WorkerHost
  implements BeforeApplicationShutdown
{
  private readonly logger = new Logger(PhotoImportProcessor.name);
  private ready = false;

  constructor(private readonly handler: PhotoImportHandler) {
    super();
  }

  /**
   * Force-close the worker before Nest's `onApplicationShutdown`.
   *
   * `@nestjs/bullmq`'s BullExplorer closes workers with `worker.close()` (no
   * force), which waits on the blocking Redis connection; that promise never
   * settles while Redis is unreachable, so SIGTERM would hang until killed.
   * Closing with `force = true` disconnects immediately. The explorer's later
   * non-forced `close()` then returns the already-settled close promise.
   */
  async beforeApplicationShutdown(): Promise<void> {
    try {
      await this.worker.close(true);
    } catch (error) {
      this.logger.warn(
        `Failed to force-close photo import worker: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** Worker liveness for GET /health/queue. */
  get isReady(): boolean {
    return this.ready;
  }

  async process(job: Job<PhotoImportJobData>): Promise<PhotoImportJobResult> {
    return this.handler.handle(job);
  }

  @OnWorkerEvent('ready')
  onReady(): void {
    this.ready = true;
    this.logger.log(
      `Photo import worker ready (queue="${PHOTO_IMPORT_QUEUE}", concurrency=${String(PHOTO_IMPORT_CONCURRENCY)})`,
    );
  }

  @OnWorkerEvent('closed')
  onClosed(): void {
    this.ready = false;
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<PhotoImportJobData> | undefined, error: Error): void {
    this.logger.error(
      `Photo import job ${String(job?.id)} failed: ${error.message}`,
      error.stack,
    );
  }
}
