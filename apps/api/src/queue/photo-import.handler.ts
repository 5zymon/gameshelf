import { Injectable } from '@nestjs/common';
import { PhotoImportPipelineService } from '../import-jobs/photo-import-pipeline.service';
import type {
  PhotoImportJobResult,
  PhotoImportRun,
} from './photo-import.types';

/**
 * Worker unit-of-work seam (ticket 3.5).
 *
 * The worker (`PhotoImportWorker`) delegates here; this class forwards to the
 * ADR-005 import pipeline. It stays a thin indirection so tests can override
 * the provider to observe scheduling without running the pipeline.
 */
@Injectable()
export class PhotoImportHandler {
  constructor(private readonly pipeline: PhotoImportPipelineService) {}

  async handle(run: PhotoImportRun): Promise<PhotoImportJobResult> {
    return this.pipeline.run(run);
  }
}
