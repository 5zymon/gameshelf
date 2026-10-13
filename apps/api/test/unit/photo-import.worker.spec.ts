import { ConflictException, Logger } from '@nestjs/common';
import type { ImportJobsService } from '../../src/import-jobs/import-jobs.service';
import {
  PermanentImportError,
  RetryableImportError,
} from '../../src/queue/photo-import.failure';
import type { PhotoImportHandler } from '../../src/queue/photo-import.handler';
import type { PhotoImportQueue } from '../../src/queue/photo-import.queue';
import {
  IMPORT_STALLED_FAILURE_REASON,
  PhotoImportWorker,
} from '../../src/queue/photo-import.worker';
import type { QueueControlService } from '../../src/queue/queue-control.service';
import { photoImportQueueOptions } from '../../src/queue/queue.options';
import { testId } from '../helpers/ids';

interface WorkerMocks {
  queue: {
    claimNext: jest.Mock;
    release: jest.Mock;
    scheduleRetry: jest.Mock;
    findStalled: jest.Mock;
    requeueStalled: jest.Mock;
    onWake: jest.Mock;
    wake: jest.Mock;
  };
  handler: { handle: jest.Mock };
  control: { isPaused: jest.Mock };
  jobs: {
    getPipelineJob: jest.Mock;
    summarizeRecognizedItems: jest.Mock;
    markFailed: jest.Mock;
  };
}

const COUNTS = { recognizedCount: 2, importedCount: 1, unrecognizedCount: 1 };

function createWorker(): {
  worker: PhotoImportWorker;
  mocks: WorkerMocks;
} {
  const mocks: WorkerMocks = {
    queue: {
      claimNext: jest.fn(() => Promise.resolve(null)),
      release: jest.fn(() => Promise.resolve()),
      scheduleRetry: jest.fn(() => Promise.resolve(true)),
      findStalled: jest.fn(() => Promise.resolve([])),
      requeueStalled: jest.fn(() => Promise.resolve(true)),
      onWake: jest.fn(() => () => undefined),
      wake: jest.fn(),
    },
    handler: {
      handle: jest.fn(() =>
        Promise.resolve({
          recognizedCount: 0,
          importedCount: 0,
          unrecognizedCount: 0,
        }),
      ),
    },
    control: { isPaused: jest.fn(() => Promise.resolve(false)) },
    jobs: {
      getPipelineJob: jest.fn(() => Promise.resolve({ status: 'processing' })),
      summarizeRecognizedItems: jest.fn(() => Promise.resolve(COUNTS)),
      markFailed: jest.fn(() => Promise.resolve()),
    },
  };
  const worker = new PhotoImportWorker(
    mocks.queue as unknown as PhotoImportQueue,
    mocks.handler as unknown as PhotoImportHandler,
    mocks.control as unknown as QueueControlService,
    mocks.jobs as unknown as ImportJobsService,
    photoImportQueueOptions({ autoStart: false }),
  );
  return { worker, mocks };
}

describe('PhotoImportWorker (unit)', () => {
  describe('processNext', () => {
    it('runs a claimed row and releases the lease on success', async () => {
      const { worker, mocks } = createWorker();
      mocks.queue.claimNext.mockResolvedValue({
        id: testId(1),
        photoRef: 'p.png',
        attempts: 1,
      });

      await expect(worker.processNext()).resolves.toBe('processed');

      expect(mocks.handler.handle).toHaveBeenCalledWith({
        importJobId: testId(1),
        photoRef: 'p.png',
        attempt: 1,
        maxAttempts: 3,
      });
      expect(mocks.queue.release).toHaveBeenCalledWith(testId(1));
      expect(mocks.queue.scheduleRetry).not.toHaveBeenCalled();
      expect(mocks.jobs.markFailed).not.toHaveBeenCalled();
    });

    it('schedules a retry with exponential backoff on attempt 1', async () => {
      const { worker, mocks } = createWorker();
      mocks.queue.claimNext.mockResolvedValue({
        id: testId(1),
        photoRef: 'p.png',
        attempts: 1,
      });
      mocks.handler.handle.mockRejectedValue(new RetryableImportError('x'));

      await expect(worker.processNext()).resolves.toBe('processed');

      expect(mocks.queue.scheduleRetry).toHaveBeenCalledWith(testId(1), 5_000);
      expect(mocks.jobs.markFailed).not.toHaveBeenCalled();
    });

    it('schedules the doubled backoff on attempt 2', async () => {
      const { worker, mocks } = createWorker();
      mocks.queue.claimNext.mockResolvedValue({
        id: testId(1),
        photoRef: 'p.png',
        attempts: 2,
      });
      mocks.handler.handle.mockRejectedValue(new RetryableImportError('x'));

      await expect(worker.processNext()).resolves.toBe('processed');

      expect(mocks.queue.scheduleRetry).toHaveBeenCalledWith(testId(1), 10_000);
    });

    it('fails the row after the last attempt instead of retrying', async () => {
      const { worker, mocks } = createWorker();
      mocks.queue.claimNext.mockResolvedValue({
        id: testId(1),
        photoRef: 'p.png',
        attempts: 3,
      });
      mocks.handler.handle.mockRejectedValue(
        new RetryableImportError('transient'),
      );
      mocks.jobs.getPipelineJob.mockResolvedValue({ status: 'processing' });

      await expect(worker.processNext()).resolves.toBe('processed');

      expect(mocks.jobs.summarizeRecognizedItems).toHaveBeenCalledWith(
        testId(1),
      );
      expect(mocks.jobs.markFailed).toHaveBeenCalledWith(
        testId(1),
        'transient',
        COUNTS,
      );
      expect(mocks.queue.release).toHaveBeenCalledWith(testId(1));
      expect(mocks.queue.scheduleRetry).not.toHaveBeenCalled();
    });

    it('does not re-fail a row the pipeline already marked failed on a permanent error', async () => {
      const { worker, mocks } = createWorker();
      mocks.queue.claimNext.mockResolvedValue({
        id: testId(1),
        photoRef: 'p.png',
        attempts: 1,
      });
      mocks.handler.handle.mockRejectedValue(
        new PermanentImportError('bad', new Error('bad')),
      );
      mocks.jobs.getPipelineJob.mockResolvedValue({ status: 'failed' });

      await expect(worker.processNext()).resolves.toBe('processed');

      expect(mocks.jobs.markFailed).not.toHaveBeenCalled();
      expect(mocks.queue.scheduleRetry).not.toHaveBeenCalled();
      expect(mocks.queue.release).toHaveBeenCalledWith(testId(1));
    });

    it('swallows a ConflictException from markFailed', async () => {
      const { worker, mocks } = createWorker();
      mocks.queue.claimNext.mockResolvedValue({
        id: testId(1),
        photoRef: 'p.png',
        attempts: 3,
      });
      mocks.handler.handle.mockRejectedValue(new RetryableImportError('x'));
      mocks.jobs.markFailed.mockRejectedValue(
        new ConflictException('already terminal'),
      );

      await expect(worker.processNext()).resolves.toBe('processed');

      expect(mocks.queue.release).toHaveBeenCalledWith(testId(1));
    });

    it('keeps the lease when marking failed throws a DB error', async () => {
      const { worker, mocks } = createWorker();
      mocks.queue.claimNext.mockResolvedValue({
        id: testId(1),
        photoRef: 'p.png',
        attempts: 3,
      });
      mocks.handler.handle.mockRejectedValue(new RetryableImportError('x'));
      mocks.jobs.markFailed.mockRejectedValue(new Error('db down'));

      await expect(worker.processNext()).resolves.toBe('processed');

      expect(mocks.jobs.markFailed).toHaveBeenCalledWith(
        testId(1),
        'x',
        COUNTS,
      );
      // The row is not settled, so the lease must stay for stall recovery.
      expect(mocks.queue.release).not.toHaveBeenCalled();
    });

    it('does not log a terminal failure when the row could not be settled', async () => {
      const { worker, mocks } = createWorker();
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      try {
        mocks.queue.claimNext.mockResolvedValue({
          id: testId(1),
          photoRef: 'p.png',
          attempts: 1,
        });
        mocks.handler.handle.mockRejectedValue(
          new PermanentImportError('bad', new Error('bad')),
        );
        mocks.jobs.markFailed.mockRejectedValue(new Error('db down'));

        await expect(worker.processNext()).resolves.toBe('processed');

        expect(mocks.queue.release).not.toHaveBeenCalled();
        // failSafely logs its own DB error; only the terminal-failure line must be absent.
        expect(warn).not.toHaveBeenCalledWith(
          expect.stringMatching(/failed (permanently|after \d+ attempts)/),
        );
      } finally {
        warn.mockRestore();
      }
    });

    it('logs a terminal failure once the row is settled', async () => {
      const { worker, mocks } = createWorker();
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      try {
        mocks.queue.claimNext.mockResolvedValue({
          id: testId(1),
          photoRef: 'p.png',
          attempts: 1,
        });
        mocks.handler.handle.mockRejectedValue(
          new PermanentImportError('bad', new Error('bad')),
        );

        await expect(worker.processNext()).resolves.toBe('processed');

        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('failed permanently'),
        );
      } finally {
        warn.mockRestore();
      }
    });

    it('returns paused and claims nothing while the queue is paused', async () => {
      const { worker, mocks } = createWorker();
      mocks.control.isPaused.mockResolvedValue(true);

      await expect(worker.processNext()).resolves.toBe('paused');

      expect(mocks.queue.claimNext).not.toHaveBeenCalled();
      expect(mocks.handler.handle).not.toHaveBeenCalled();
    });

    it('returns idle when no row is due', async () => {
      const { worker, mocks } = createWorker();

      await expect(worker.processNext()).resolves.toBe('idle');

      expect(mocks.handler.handle).not.toHaveBeenCalled();
    });

    it('returns idle and does not throw when the claim query fails', async () => {
      const { worker, mocks } = createWorker();
      mocks.queue.claimNext.mockRejectedValue(new Error('db down'));

      await expect(worker.processNext()).resolves.toBe('idle');
    });
  });

  describe('recoverStalled', () => {
    it('re-queues a stalled row that still has attempts left', async () => {
      const { worker, mocks } = createWorker();
      mocks.queue.findStalled.mockResolvedValue([
        { id: testId(1), attempts: 1 },
      ]);

      await expect(worker.recoverStalled()).resolves.toEqual({
        requeued: 1,
        failed: 0,
      });

      expect(mocks.queue.requeueStalled).toHaveBeenCalledWith(testId(1), 5_000);
      expect(mocks.jobs.markFailed).not.toHaveBeenCalled();
    });

    it('fails a stalled row that ran out of attempts', async () => {
      const { worker, mocks } = createWorker();
      mocks.queue.findStalled.mockResolvedValue([
        { id: testId(2), attempts: 3 },
      ]);

      await expect(worker.recoverStalled()).resolves.toEqual({
        requeued: 0,
        failed: 1,
      });

      expect(mocks.jobs.markFailed).toHaveBeenCalledWith(
        testId(2),
        IMPORT_STALLED_FAILURE_REASON,
        COUNTS,
      );
      expect(mocks.queue.release).toHaveBeenCalledWith(testId(2));
      expect(mocks.queue.requeueStalled).not.toHaveBeenCalled();
    });

    it('keeps the lease when failing an out-of-attempts stalled row errors', async () => {
      const { worker, mocks } = createWorker();
      mocks.queue.findStalled.mockResolvedValue([
        { id: testId(2), attempts: 3 },
      ]);
      mocks.jobs.markFailed.mockRejectedValue(new Error('db down'));

      await expect(worker.recoverStalled()).resolves.toEqual({
        requeued: 0,
        failed: 0,
      });

      expect(mocks.queue.release).not.toHaveBeenCalled();
      expect(mocks.queue.requeueStalled).not.toHaveBeenCalled();
    });
  });

  describe('lifecycle', () => {
    it('does not poll on bootstrap when autoStart is false', async () => {
      const { worker, mocks } = createWorker();

      await worker.onApplicationBootstrap();

      expect(worker.isReady).toBe(false);
      expect(mocks.queue.findStalled).not.toHaveBeenCalled();
      expect(mocks.queue.claimNext).not.toHaveBeenCalled();
      expect(mocks.queue.onWake).not.toHaveBeenCalled();
    });
  });
});
