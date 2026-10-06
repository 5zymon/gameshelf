import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import type {
  PhotoImportJobData,
  PhotoImportJobResult,
} from './photo-import.types';

/**
 * Placeholder unit-of-work handler.
 *
 * Ticket 3.1 stands the queue up; the real pipeline (vision call +
 * IGDB/MobyGames matching, ADR-002) is ticket 3.5. Until then this
 * acknowledges jobs so the worker is exercised end to end. It performs no
 * catalog writes.
 *
 * This class is the seam used by tests to observe scheduling (override the
 * provider) and will be the insertion point for 3.5.
 */
@Injectable()
export class PhotoImportHandler {
  private readonly logger = new Logger(PhotoImportHandler.name);

  async handle(job: Job<PhotoImportJobData>): Promise<PhotoImportJobResult> {
    // TODO(ticket 3.5): replace with the ADR-002 import pipeline.
    this.logger.log(
      `Photo import job ${String(job.id)} acknowledged (placeholder for ticket 3.5)`,
    );
    // No asynchronous work yet; ticket 3.5 introduces the real pipeline. The
    // Promise keeps the async contract without an empty `await`.
    return Promise.resolve({
      recognizedCount: 0,
      importedCount: 0,
      unrecognizedCount: 0,
    });
  }
}
