import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { PhotoImportProcessor } from './photo-import.processor';
import {
  PHOTO_IMPORT_CONCURRENCY,
  PHOTO_IMPORT_QUEUE,
} from './queue.constants';

/** Fail fast instead of hanging when Redis is unreachable. */
export const QUEUE_HEALTH_TIMEOUT_MS = 2_000;

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
    @InjectQueue(PHOTO_IMPORT_QUEUE) private readonly queue: Queue,
    private readonly processor: PhotoImportProcessor,
  ) {}

  async getHealth(): Promise<QueueHealth> {
    // BullMQ 6's `JobType` no longer includes 'paused', so paused state is not
    // part of the job-count surface (queue pause is out of scope for ticket
    // 3.1). `prioritized` and `waiting-children` are included for ticket 3.2.
    const counts = await this.withTimeout(
      this.queue.getJobCounts(
        'waiting',
        'active',
        'completed',
        'failed',
        'delayed',
        'prioritized',
        'waiting-children',
      ),
    );
    return {
      status: 'ok',
      queue: PHOTO_IMPORT_QUEUE,
      concurrency: PHOTO_IMPORT_CONCURRENCY,
      workerReady: this.processor.isReady,
      counts,
    };
  }

  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error('Redis did not respond in time'));
          }, QUEUE_HEALTH_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
