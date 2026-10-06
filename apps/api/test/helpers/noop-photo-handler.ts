import type { Job } from 'bullmq';
import type {
  PhotoImportJobData,
  PhotoImportJobResult,
} from '../../src/queue/photo-import.types';

/** Result a no-op handler reports: nothing recognized, nothing imported. */
export const NOOP_PHOTO_IMPORT_RESULT: PhotoImportJobResult = {
  recognizedCount: 0,
  importedCount: 0,
  unrecognizedCount: 0,
};

export interface NoopPhotoImportHandler {
  handle: (job: Job<PhotoImportJobData>) => Promise<PhotoImportJobResult>;
}

/**
 * Test double for `PhotoImportHandler` used by e2e suites that enqueue real
 * jobs but must not run recognition, external lookups, or catalog writes.
 */
export function createNoopPhotoImportHandler(): NoopPhotoImportHandler {
  return {
    handle: () => Promise.resolve(NOOP_PHOTO_IMPORT_RESULT),
  };
}
