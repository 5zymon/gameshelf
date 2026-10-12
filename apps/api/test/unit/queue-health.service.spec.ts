import type { PhotoImportQueue } from '../../src/queue/photo-import.queue';
import type { PhotoImportWorker } from '../../src/queue/photo-import.worker';
import {
  PHOTO_IMPORT_CONCURRENCY,
  PHOTO_IMPORT_QUEUE,
} from '../../src/queue/queue.constants';
import { QueueHealthService } from '../../src/queue/queue-health.service';

describe('QueueHealthService (unit)', () => {
  it('reports the MySQL counts and the worker readiness', async () => {
    const counts = {
      queued: 1,
      processing: 2,
      done: 3,
      needs_attention: 0,
      failed: 1,
      dismissed: 0,
    };
    const photoQueue = {
      countByStatus: jest.fn(() => Promise.resolve(counts)),
    };
    const worker = { isReady: true };
    const service = new QueueHealthService(
      photoQueue as unknown as PhotoImportQueue,
      worker as unknown as PhotoImportWorker,
    );

    await expect(service.getHealth()).resolves.toEqual({
      status: 'ok',
      queue: PHOTO_IMPORT_QUEUE,
      concurrency: PHOTO_IMPORT_CONCURRENCY,
      workerReady: true,
      counts,
    });
    expect(photoQueue.countByStatus).toHaveBeenCalledTimes(1);
  });
});
