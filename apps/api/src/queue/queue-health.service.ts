import { Injectable } from '@nestjs/common';
import { PhotoImportQueue } from './photo-import.queue';
import { PhotoImportWorker } from './photo-import.worker';
import {
  PHOTO_IMPORT_CONCURRENCY,
  PHOTO_IMPORT_QUEUE,
} from './queue.constants';

export interface QueueHealth {
  status: 'ok';
  queue: string;
  concurrency: number;
  workerReady: boolean;
  counts: Record<string, number>;
}

@Injectable()
export class QueueHealthService {
  constructor(
    private readonly photoQueue: PhotoImportQueue,
    private readonly worker: PhotoImportWorker,
  ) {}

  /** Counts come from one `GROUP BY status` over `import_jobs` (ADR-005). */
  async getHealth(): Promise<QueueHealth> {
    return {
      status: 'ok',
      queue: PHOTO_IMPORT_QUEUE,
      concurrency: PHOTO_IMPORT_CONCURRENCY,
      workerReady: this.worker.isReady,
      counts: await this.photoQueue.countByStatus(),
    };
  }
}
