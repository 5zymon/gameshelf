import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PhotoImportPipelineService } from '../import-jobs/photo-import-pipeline.service';
import type {
  PhotoImportJobData,
  PhotoImportJobResult,
} from './photo-import.types';

/**
 * BullMQ unit-of-work seam (ticket 3.5).
 *
 * The worker (`PhotoImportProcessor`) delegates here; this class forwards to
 * the ADR-002 import pipeline. It stays a thin indirection so tests can
 * override the provider to observe scheduling without running the pipeline.
 */
@Injectable()
export class PhotoImportHandler {
  constructor(private readonly pipeline: PhotoImportPipelineService) {}

  async handle(job: Job<PhotoImportJobData>): Promise<PhotoImportJobResult> {
    return this.pipeline.run(job);
  }
}
