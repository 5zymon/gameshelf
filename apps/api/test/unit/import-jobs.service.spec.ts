import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import { Prisma } from '../../src/generated/prisma/client';
import { ImportJobsService } from '../../src/import-jobs/import-jobs.service';
import { IMPORT_QUEUE_STATE_TIMEOUT_MS } from '../../src/import-jobs/import-pipeline.options';
import type { PhotoImportJobData } from '../../src/queue/photo-import.types';
import { RetryableImportError } from '../../src/queue/photo-import.failure';
import type { PlatformsService } from '../../src/platforms/platforms.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { QueueControlService } from '../../src/queue/queue-control.service';
import type { GameEnrichmentService } from '../../src/enrichment/game-enrichment.service';

interface ImportJobsPrismaMock {
  importJob: {
    findMany: jest.Mock;
    count: jest.Mock;
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
    groupBy: jest.Mock;
  };
  unrecognizedItem: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  recognizedItem: {
    findMany: jest.Mock;
    createMany: jest.Mock;
    updateMany: jest.Mock;
    update: jest.Mock;
    groupBy: jest.Mock;
  };
  platform: {
    findMany: jest.Mock;
    create: jest.Mock;
  };
  platformAlias: {
    findUnique: jest.Mock;
  };
  game: {
    create: jest.Mock;
  };
  $transaction: jest.Mock;
}

interface QueueControlMock {
  pauseForConfig: jest.Mock;
  resume: jest.Mock;
  resumeIfPausedBy: jest.Mock;
  getState: jest.Mock;
}

function createService(): {
  service: ImportJobsService;
  mock: ImportJobsPrismaMock;
  queue: { getJob: jest.Mock; add: jest.Mock };
  queueControl: QueueControlMock;
  enrichment: { enrichCandidate: jest.Mock };
  platforms: { createFromImport: jest.Mock };
  identity: { findExisting: jest.Mock };
  maintenance: { removeIfUnreferenced: jest.Mock };
} {
  const mock: ImportJobsPrismaMock = {
    importJob: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      groupBy: jest.fn(),
    },
    unrecognizedItem: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    recognizedItem: {
      findMany: jest.fn(),
      createMany: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
      groupBy: jest.fn(),
    },
    platform: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    platformAlias: {
      findUnique: jest.fn(),
    },
    game: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  // Interactive transactions run the callback against the same mock as `tx`.
  mock.$transaction.mockImplementation(
    (callback: (tx: ImportJobsPrismaMock) => unknown) => callback(mock),
  );
  // No batch/aggregate by default; tests that need it override the result.
  mock.importJob.groupBy.mockResolvedValue([]);
  mock.recognizedItem.groupBy.mockResolvedValue([]);
  const queue = { getJob: jest.fn(), add: jest.fn() };
  const queueControl: QueueControlMock = {
    pauseForConfig: jest.fn(),
    resume: jest.fn(() => Promise.resolve()),
    resumeIfPausedBy: jest.fn(() => Promise.resolve(false)),
    getState: jest.fn(() =>
      Promise.resolve({
        paused: false,
        reason: null,
        source: null,
        pausedAt: null,
      }),
    ),
  };
  const enrichment = { enrichCandidate: jest.fn() };
  const platforms = { createFromImport: jest.fn() };
  const identity = { findExisting: jest.fn(() => Promise.resolve(null)) };
  const maintenance = {
    removeIfUnreferenced: jest.fn(() => Promise.resolve()),
  };
  return {
    service: new ImportJobsService(
      mock as unknown as PrismaService,
      queue as unknown as Queue<PhotoImportJobData>,
      queueControl as unknown as QueueControlService,
      enrichment as unknown as GameEnrichmentService,
      platforms as unknown as PlatformsService,
      identity as never,
      maintenance as never,
    ),
    mock,
    queue,
    queueControl,
    enrichment,
    platforms,
    identity,
    maintenance,
  };
}

/** Prisma 7 known-request error (P2025) for the mock. */
function knownError(
  code: string,
  meta?: Record<string, unknown>,
): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('mock error', {
    code,
    clientVersion: '7.10.0',
    meta,
  });
}

const JOB = {
  id: 1,
  status: 'needs_attention',
  declaredCount: 2,
  photoRef: null,
  batchId: null,
  bullJobId: null,
  recognizedCount: 1,
  importedCount: 1,
  unrecognizedCount: 1,
  errorMessage: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  completedAt: new Date('2026-01-01T01:00:00.000Z'),
  unrecognizedItems: [] as unknown[],
};

const ITEM = {
  id: 5,
  importJobId: 1,
  rawTitle: 'PlayStaton 5',
  rawPlatform: 'PS4',
  reason: 'no candidate passed acceptance',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  dismissedAt: null,
};

describe('ImportJobsService (unit)', () => {
  let service: ImportJobsService;
  let mock: ImportJobsPrismaMock;
  let queue: { getJob: jest.Mock; add: jest.Mock };
  let queueControl: QueueControlMock;
  let enrichment: { enrichCandidate: jest.Mock };
  let platforms: { createFromImport: jest.Mock };
  let identity: { findExisting: jest.Mock };
  let maintenance: { removeIfUnreferenced: jest.Mock };

  beforeEach(() => {
    ({
      service,
      mock,
      queue,
      queueControl,
      enrichment,
      platforms,
      identity,
      maintenance,
    } = createService());
  });

  describe('list', () => {
    it('applies defaults: newest first, page 1, limit 20', async () => {
      mock.importJob.findMany.mockResolvedValue([]);
      mock.importJob.count.mockResolvedValue(0);

      const result = await service.list({});

      expect(mock.importJob.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 0,
        take: 20,
      });
      expect(mock.importJob.count).toHaveBeenCalledWith({ where: {} });
      expect(result.meta).toEqual({
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
      });
    });

    it('filters by status', async () => {
      mock.importJob.findMany.mockResolvedValue([]);
      mock.importJob.count.mockResolvedValue(0);

      await service.list({ status: 'done' });

      expect(mock.importJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'done' } }),
      );
      expect(mock.importJob.count).toHaveBeenCalledWith({
        where: { status: 'done' },
      });
    });

    it('computes skip/take and totalPages', async () => {
      mock.importJob.findMany.mockResolvedValue([]);
      mock.importJob.count.mockResolvedValue(12);

      const result = await service.list({ page: 2, limit: 5 });

      expect(mock.importJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 5, take: 5 }),
      );
      expect(result.meta).toEqual({
        page: 2,
        limit: 5,
        total: 12,
        totalPages: 3,
      });
    });
  });

  describe('findOne', () => {
    it('returns the job with all unrecognized items (id asc)', async () => {
      mock.importJob.findUnique.mockResolvedValue(JOB);

      const result = await service.findOne(1);

      expect(mock.importJob.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        include: { unrecognizedItems: { orderBy: { id: 'asc' } } },
      });
      expect(result).toMatchObject(JOB);
    });

    it('throws 404 for an unknown job', async () => {
      mock.importJob.findUnique.mockResolvedValue(null);

      await expect(service.findOne(9)).rejects.toThrow(
        new NotFoundException('Import job with id 9 not found'),
      );
    });
  });

  describe('listUnrecognized', () => {
    it('throws 404 for an unknown job', async () => {
      mock.importJob.findUnique.mockResolvedValue(null);

      await expect(service.listUnrecognized(9)).rejects.toThrow(
        new NotFoundException('Import job with id 9 not found'),
      );
      expect(mock.unrecognizedItem.findMany).not.toHaveBeenCalled();
    });

    it('returns only non-dismissed items, id asc', async () => {
      mock.importJob.findUnique.mockResolvedValue({ id: 1 });
      mock.unrecognizedItem.findMany.mockResolvedValue([ITEM]);

      const result = await service.listUnrecognized(1);

      expect(mock.unrecognizedItem.findMany).toHaveBeenCalledWith({
        where: { importJobId: 1, dismissedAt: null },
        orderBy: { id: 'asc' },
      });
      expect(result).toEqual([ITEM]);
    });
  });

  describe('dismissJob', () => {
    it('throws 404 for an unknown job', async () => {
      mock.importJob.findUnique.mockResolvedValue(null);

      await expect(service.dismissJob(9)).rejects.toThrow(
        new NotFoundException('Import job with id 9 not found'),
      );
    });

    it('is a 200 no-op for an already-dismissed job', async () => {
      const fullJob = { ...JOB, unrecognizedItems: [] };
      mock.importJob.findUnique
        .mockResolvedValueOnce({ id: 1, status: 'dismissed' })
        .mockResolvedValueOnce(fullJob);

      const result = await service.dismissJob(1);

      expect(mock.importJob.update).not.toHaveBeenCalled();
      expect(result).toMatchObject(fullJob);
    });

    it.each(['queued', 'processing', 'done'] as const)(
      'rejects dismissing a %s job with 409',
      async (status) => {
        mock.importJob.findUnique.mockResolvedValue({ id: 1, status });

        await expect(service.dismissJob(1)).rejects.toThrow(ConflictException);
        expect(mock.importJob.update).not.toHaveBeenCalled();
      },
    );

    it('dismisses a failed job (failed is dismissable too)', async () => {
      const fullJob = { ...JOB, status: 'dismissed', unrecognizedItems: [] };
      mock.importJob.findUnique
        .mockResolvedValueOnce({ id: 1, status: 'failed' })
        .mockResolvedValueOnce(fullJob);
      mock.importJob.update.mockResolvedValue(fullJob);

      const result = await service.dismissJob(1);

      expect(mock.importJob.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: 'dismissed' },
      });
      expect(result).toMatchObject(fullJob);
    });

    it('dismisses a needs_attention job and returns the detail', async () => {
      const fullJob = { ...JOB, status: 'dismissed', unrecognizedItems: [] };
      mock.importJob.findUnique
        .mockResolvedValueOnce({ id: 1, status: 'needs_attention' })
        .mockResolvedValueOnce(fullJob);
      mock.importJob.update.mockResolvedValue(fullJob);

      const result = await service.dismissJob(1);

      expect(mock.importJob.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: 'dismissed' },
      });
      expect(result).toMatchObject(fullJob);
    });

    it('maps P2025 (deleted mid-flight) to 404', async () => {
      mock.importJob.findUnique.mockResolvedValue({ id: 1, status: 'failed' });
      mock.importJob.update.mockRejectedValue(knownError('P2025'));

      await expect(service.dismissJob(1)).rejects.toThrow(
        new NotFoundException('Import job with id 1 not found'),
      );
    });
  });

  describe('dismissUnrecognizedItem', () => {
    it('throws 404 for a missing item', async () => {
      mock.unrecognizedItem.findUnique.mockResolvedValue(null);

      await expect(service.dismissUnrecognizedItem(1, 5)).rejects.toThrow(
        new NotFoundException(
          'Unrecognized item with id 5 not found in import job 1',
        ),
      );
      expect(mock.unrecognizedItem.update).not.toHaveBeenCalled();
    });

    it('throws 404 when the item belongs to another job', async () => {
      mock.unrecognizedItem.findUnique.mockResolvedValue({
        id: 5,
        importJobId: 99,
        dismissedAt: null,
      });

      await expect(service.dismissUnrecognizedItem(1, 5)).rejects.toThrow(
        new NotFoundException(
          'Unrecognized item with id 5 not found in import job 1',
        ),
      );
      expect(mock.unrecognizedItem.update).not.toHaveBeenCalled();
    });

    it('is a 200 no-op for an already-dismissed item', async () => {
      const dismissedAt = new Date('2026-01-02T00:00:00.000Z');
      const updated = { ...ITEM, dismissedAt };
      mock.unrecognizedItem.findUnique
        .mockResolvedValueOnce({ id: 5, importJobId: 1, dismissedAt })
        .mockResolvedValueOnce(updated);

      const result = await service.dismissUnrecognizedItem(1, 5);

      expect(mock.unrecognizedItem.update).not.toHaveBeenCalled();
      expect(result).toBe(updated);
    });

    it('stamps dismissedAt and returns the updated item', async () => {
      const updated = {
        ...ITEM,
        dismissedAt: new Date('2026-01-02T00:00:00.000Z'),
      };
      mock.unrecognizedItem.findUnique
        .mockResolvedValueOnce({ id: 5, importJobId: 1, dismissedAt: null })
        .mockResolvedValueOnce(updated);
      mock.unrecognizedItem.update.mockResolvedValue(updated);

      const result = await service.dismissUnrecognizedItem(1, 5);

      expect(mock.unrecognizedItem.update).toHaveBeenCalledWith({
        where: { id: 5 },
        data: { dismissedAt: expect.any(Date) as Date },
      });
      expect(result).toBe(updated);
    });

    it('maps P2025 (deleted mid-flight) to 404', async () => {
      mock.unrecognizedItem.findUnique.mockResolvedValue({
        id: 5,
        importJobId: 1,
        dismissedAt: null,
      });
      mock.unrecognizedItem.update.mockRejectedValue(knownError('P2025'));

      await expect(service.dismissUnrecognizedItem(1, 5)).rejects.toThrow(
        new NotFoundException('Unrecognized item with id 5 not found'),
      );
    });
  });

  describe('createJob', () => {
    it('creates a queued job with a null declaredCount by default', async () => {
      mock.importJob.create.mockResolvedValue({ ...JOB, status: 'queued' });

      const result = await service.createJob({});

      expect(mock.importJob.create).toHaveBeenCalledWith({
        data: {
          status: 'queued',
          declaredCount: null,
          photoRef: null,
          batchId: null,
          enqueuedAt: expect.any(Date) as Date,
        },
      });
      expect(result).toEqual({ ...JOB, status: 'queued' });
    });

    it('persists the declared count when provided', async () => {
      mock.importJob.create.mockResolvedValue({
        ...JOB,
        status: 'queued',
        declaredCount: 12,
      });

      await service.createJob({ declaredCount: 12 });

      expect(mock.importJob.create).toHaveBeenCalledWith({
        data: {
          status: 'queued',
          declaredCount: 12,
          photoRef: null,
          batchId: null,
          enqueuedAt: expect.any(Date) as Date,
        },
      });
    });

    it('persists the ephemeral photo reference when provided (ticket 3.2)', async () => {
      mock.importJob.create.mockResolvedValue({
        ...JOB,
        status: 'queued',
        photoRef: 'abc.png',
      });

      await service.createJob({ photoRef: 'abc.png' });

      expect(mock.importJob.create).toHaveBeenCalledWith({
        data: {
          status: 'queued',
          declaredCount: null,
          photoRef: 'abc.png',
          batchId: null,
          enqueuedAt: expect.any(Date) as Date,
        },
      });
    });
  });

  describe('markProcessing', () => {
    it('transitions queued -> processing', async () => {
      mock.importJob.findUnique.mockResolvedValue({
        id: 1,
        status: 'queued',
        declaredCount: null,
      });
      mock.importJob.update.mockResolvedValue({ ...JOB, status: 'processing' });

      await service.markProcessing(1);

      expect(mock.importJob.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: 'processing', enqueuedAt: expect.any(Date) as Date },
      });
    });

    it('is idempotent on processing (BullMQ retry)', async () => {
      mock.importJob.findUnique.mockResolvedValue({
        id: 1,
        status: 'processing',
        declaredCount: null,
      });
      mock.importJob.update.mockResolvedValue({ ...JOB, status: 'processing' });

      await service.markProcessing(1);

      expect(mock.importJob.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: 'processing', enqueuedAt: expect.any(Date) as Date },
      });
    });

    it('rejects a terminal job with 409', async () => {
      mock.importJob.findUnique.mockResolvedValue({
        id: 1,
        status: 'done',
        declaredCount: null,
      });

      await expect(service.markProcessing(1)).rejects.toThrow(
        ConflictException,
      );
      expect(mock.importJob.update).not.toHaveBeenCalled();
    });

    it('throws 404 for an unknown job', async () => {
      mock.importJob.findUnique.mockResolvedValue(null);

      await expect(service.markProcessing(9)).rejects.toThrow(
        new NotFoundException('Import job with id 9 not found'),
      );
    });
  });

  describe('markCompleted', () => {
    it('marks done when everything was recognized and matches the declaration', async () => {
      mock.importJob.findUnique.mockResolvedValue({
        id: 1,
        status: 'processing',
        declaredCount: 2,
      });
      mock.importJob.updateMany.mockResolvedValue({ count: 1 });

      await service.markCompleted(1, {
        recognizedCount: 2,
        importedCount: 2,
        unrecognizedCount: 0,
      });

      expect(mock.importJob.updateMany).toHaveBeenCalledWith({
        where: { id: 1, status: { in: ['queued', 'processing'] } },
        data: {
          status: 'done',
          recognizedCount: 2,
          importedCount: 2,
          unrecognizedCount: 0,
          completedAt: expect.any(Date) as Date,
        },
      });
    });

    it('marks done when no count was declared and items were recognized', async () => {
      mock.importJob.findUnique.mockResolvedValue({
        id: 1,
        status: 'processing',
        declaredCount: null,
      });
      mock.importJob.updateMany.mockResolvedValue({ count: 1 });

      await service.markCompleted(1, {
        recognizedCount: 4,
        importedCount: 4,
        unrecognizedCount: 0,
      });

      expect(mock.importJob.updateMany).toHaveBeenCalledWith({
        where: { id: 1, status: { in: ['queued', 'processing'] } },
        data: {
          status: 'done',
          recognizedCount: 4,
          importedCount: 4,
          unrecognizedCount: 0,
          completedAt: expect.any(Date) as Date,
        },
      });
    });

    it('marks needs_attention when the declared count matches but an item is unrecognized', async () => {
      mock.importJob.findUnique.mockResolvedValue({
        id: 1,
        status: 'processing',
        declaredCount: 2,
      });
      mock.importJob.updateMany.mockResolvedValue({ count: 1 });

      await service.markCompleted(1, {
        recognizedCount: 2,
        importedCount: 1,
        unrecognizedCount: 1,
      });

      expect(mock.importJob.updateMany).toHaveBeenCalledWith({
        where: { id: 1, status: { in: ['queued', 'processing'] } },
        data: {
          status: 'needs_attention',
          recognizedCount: 2,
          importedCount: 1,
          unrecognizedCount: 1,
          completedAt: expect.any(Date) as Date,
        },
      });
    });

    it('marks needs_attention when nothing was recognized', async () => {
      mock.importJob.findUnique.mockResolvedValue({
        id: 1,
        status: 'queued',
        declaredCount: null,
      });
      mock.importJob.updateMany.mockResolvedValue({ count: 1 });

      await service.markCompleted(1, {
        recognizedCount: 0,
        importedCount: 0,
        unrecognizedCount: 0,
      });

      expect(mock.importJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'needs_attention' }) as {
            status: string;
          },
        }),
      );
    });

    it('marks needs_attention on a declared-count mismatch', async () => {
      mock.importJob.findUnique.mockResolvedValue({
        id: 1,
        status: 'processing',
        declaredCount: 5,
      });
      mock.importJob.updateMany.mockResolvedValue({ count: 1 });

      await service.markCompleted(1, {
        recognizedCount: 3,
        importedCount: 3,
        unrecognizedCount: 0,
      });

      expect(mock.importJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'needs_attention' }) as {
            status: string;
          },
        }),
      );
    });

    it('marks needs_attention when any item was flagged', async () => {
      mock.importJob.findUnique.mockResolvedValue({
        id: 1,
        status: 'processing',
        declaredCount: null,
      });
      mock.importJob.updateMany.mockResolvedValue({ count: 1 });

      await service.markCompleted(1, {
        recognizedCount: 3,
        importedCount: 2,
        unrecognizedCount: 1,
      });

      expect(mock.importJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'needs_attention' }) as {
            status: string;
          },
        }),
      );
    });

    it('rejects a terminal job with 409 (a late callback cannot clobber a dismissal)', async () => {
      mock.importJob.findUnique.mockResolvedValue({
        id: 1,
        status: 'dismissed',
        declaredCount: null,
      });

      await expect(
        service.markCompleted(1, {
          recognizedCount: 1,
          importedCount: 1,
          unrecognizedCount: 0,
        }),
      ).rejects.toThrow(ConflictException);
      expect(mock.importJob.updateMany).not.toHaveBeenCalled();
    });

    it('409s when the row turned terminal between the read and the write (TOCTOU)', async () => {
      mock.importJob.findUnique.mockResolvedValue({
        id: 1,
        status: 'processing',
        declaredCount: null,
      });
      // A racing markFailed committed after our read, so the guarded write
      // matches no row.
      mock.importJob.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.markCompleted(1, {
          recognizedCount: 1,
          importedCount: 1,
          unrecognizedCount: 0,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws 404 for an unknown job', async () => {
      mock.importJob.findUnique.mockResolvedValue(null);

      await expect(
        service.markCompleted(9, {
          recognizedCount: 1,
          importedCount: 1,
          unrecognizedCount: 0,
        }),
      ).rejects.toThrow(
        new NotFoundException('Import job with id 9 not found'),
      );
    });
  });

  describe('markFailed', () => {
    it('marks failed with the reason and a completedAt stamp', async () => {
      mock.importJob.findUnique.mockResolvedValue({
        id: 1,
        status: 'processing',
        declaredCount: null,
      });
      mock.importJob.updateMany.mockResolvedValue({ count: 1 });

      await service.markFailed(1, 'LLM request timed out');

      expect(mock.importJob.updateMany).toHaveBeenCalledWith({
        where: { id: 1, status: { in: ['queued', 'processing'] } },
        data: {
          status: 'failed',
          errorMessage: 'LLM request timed out',
          completedAt: expect.any(Date) as Date,
        },
      });
    });

    it('persists the partial counters when they are supplied', async () => {
      mock.importJob.findUnique.mockResolvedValue({
        id: 1,
        status: 'processing',
        declaredCount: null,
      });
      mock.importJob.updateMany.mockResolvedValue({ count: 1 });

      await service.markFailed(1, 'worker killed mid-job', {
        recognizedCount: 12,
        importedCount: 10,
        unrecognizedCount: 0,
      });

      expect(mock.importJob.updateMany).toHaveBeenCalledWith({
        where: { id: 1, status: { in: ['queued', 'processing'] } },
        data: {
          status: 'failed',
          errorMessage: 'worker killed mid-job',
          completedAt: expect.any(Date) as Date,
          recognizedCount: 12,
          importedCount: 10,
          unrecognizedCount: 0,
        },
      });
    });

    it('rejects a terminal job with 409', async () => {
      mock.importJob.findUnique.mockResolvedValue({
        id: 1,
        status: 'done',
        declaredCount: null,
      });

      await expect(service.markFailed(1, 'boom')).rejects.toThrow(
        ConflictException,
      );
      expect(mock.importJob.updateMany).not.toHaveBeenCalled();
    });

    it('409s when the row turned terminal between the read and the write (TOCTOU)', async () => {
      mock.importJob.findUnique.mockResolvedValue({
        id: 1,
        status: 'processing',
        declaredCount: null,
      });
      // A racing markCompleted committed after our read, so the guarded write
      // matches no row and the failure marking is not clobbered.
      mock.importJob.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.markFailed(1, 'boom')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('addUnrecognizedItem', () => {
    it('creates the trace row with null defaults', async () => {
      mock.importJob.findUnique.mockResolvedValue({ id: 1 });
      mock.unrecognizedItem.create.mockResolvedValue(ITEM);

      const result = await service.addUnrecognizedItem(1, {
        rawTitle: 'PlayStaton 5',
      });

      expect(mock.unrecognizedItem.create).toHaveBeenCalledWith({
        data: {
          importJobId: 1,
          rawTitle: 'PlayStaton 5',
          rawPlatform: null,
          reason: null,
        },
      });
      expect(result).toBe(ITEM);
    });

    it('persists rawPlatform and reason when provided', async () => {
      mock.importJob.findUnique.mockResolvedValue({ id: 1 });
      mock.unrecognizedItem.create.mockResolvedValue(ITEM);

      await service.addUnrecognizedItem(1, {
        rawTitle: 'PlayStaton 5',
        rawPlatform: 'PS4',
        reason: 'no candidate passed acceptance',
      });

      expect(mock.unrecognizedItem.create).toHaveBeenCalledWith({
        data: {
          importJobId: 1,
          rawTitle: 'PlayStaton 5',
          rawPlatform: 'PS4',
          reason: 'no candidate passed acceptance',
        },
      });
    });

    it('throws 404 for an unknown job', async () => {
      mock.importJob.findUnique.mockResolvedValue(null);

      await expect(
        service.addUnrecognizedItem(9, { rawTitle: 'x' }),
      ).rejects.toThrow(
        new NotFoundException('Import job with id 9 not found'),
      );
      expect(mock.unrecognizedItem.create).not.toHaveBeenCalled();
    });
  });

  describe('getPipelineJob', () => {
    it('selects the pipeline snapshot', async () => {
      const state = {
        id: 1,
        status: 'processing',
        declaredCount: 2,
        photoRef: 'p.png',
        visionCompletedAt: null,
        recognizedCount: 1,
        importedCount: 0,
        unrecognizedCount: 0,
      };
      mock.importJob.findUnique.mockResolvedValue(state);

      const result = await service.getPipelineJob(1);

      expect(mock.importJob.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        select: {
          id: true,
          status: true,
          declaredCount: true,
          photoRef: true,
          visionCompletedAt: true,
          recognizedCount: true,
          importedCount: true,
          unrecognizedCount: true,
        },
      });
      expect(result).toBe(state);
    });

    it('returns null for an unknown job', async () => {
      mock.importJob.findUnique.mockResolvedValue(null);

      await expect(service.getPipelineJob(9)).resolves.toBeNull();
    });
  });

  describe('findJobIdByPhotoRef', () => {
    it('returns the newest matching id', async () => {
      mock.importJob.findFirst.mockResolvedValue({ id: 7 });

      await expect(service.findJobIdByPhotoRef('p.png')).resolves.toBe(7);
      expect(mock.importJob.findFirst).toHaveBeenCalledWith({
        where: { photoRef: 'p.png' },
        orderBy: { id: 'desc' },
        select: { id: true },
      });
    });

    it('returns null when no row has that photoRef', async () => {
      mock.importJob.findFirst.mockResolvedValue(null);

      await expect(service.findJobIdByPhotoRef('x')).resolves.toBeNull();
    });
  });

  describe('findPhotoOwners', () => {
    it('returns an empty map without querying for no refs', async () => {
      await expect(service.findPhotoOwners([])).resolves.toEqual(new Map());
      expect(mock.importJob.findMany).not.toHaveBeenCalled();
    });

    it('maps the newest row per photoRef and skips null refs', async () => {
      const createdAt = new Date('2026-01-01T00:00:00.000Z');
      const enqueuedAt = new Date('2026-01-01T01:00:00.000Z');
      const completedAt = new Date('2026-01-02T00:00:00.000Z');
      mock.importJob.findMany.mockResolvedValue([
        {
          id: 1,
          photoRef: 'p.png',
          status: 'failed',
          createdAt,
          enqueuedAt,
          completedAt: null,
        },
        {
          id: 2,
          photoRef: 'p.png',
          status: 'done',
          createdAt,
          enqueuedAt,
          completedAt,
        },
        {
          id: 3,
          photoRef: null,
          status: 'queued',
          createdAt,
          enqueuedAt: null,
          completedAt: null,
        },
      ]);

      const owners = await service.findPhotoOwners(['p.png']);

      expect(mock.importJob.findMany).toHaveBeenCalledWith({
        where: { photoRef: { in: ['p.png'] } },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          photoRef: true,
          status: true,
          createdAt: true,
          enqueuedAt: true,
          completedAt: true,
        },
      });
      expect(owners.get('p.png')).toEqual({
        id: 2,
        status: 'done',
        createdAt,
        enqueuedAt,
        completedAt,
      });
      expect(owners.size).toBe(1);
    });
  });

  describe('releaseSweptPhoto', () => {
    it('clears photoRef behind the id/ref/status guard', async () => {
      mock.importJob.updateMany.mockResolvedValue({ count: 1 });

      const claimed = await service.releaseSweptPhoto(7, 'p.png', 'dismissed');

      expect(claimed).toBe(true);
      expect(mock.importJob.updateMany).toHaveBeenCalledWith({
        where: { id: 7, photoRef: 'p.png', status: 'dismissed' },
        data: { photoRef: null },
      });
    });

    it('marks an abandoned job failed as well when a reason is given', async () => {
      mock.importJob.updateMany.mockResolvedValue({ count: 1 });

      await service.releaseSweptPhoto(7, 'p.png', 'queued', 'abandoned');

      expect(mock.importJob.updateMany).toHaveBeenCalledWith({
        where: { id: 7, photoRef: 'p.png', status: 'queued' },
        data: {
          photoRef: null,
          status: 'failed',
          errorMessage: 'abandoned',
          completedAt: expect.any(Date) as Date,
        },
      });
    });

    it('reports false when the guarded write matched no row', async () => {
      mock.importJob.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.releaseSweptPhoto(7, 'p.png', 'done')).resolves.toBe(
        false,
      );
    });
  });

  describe('saveRecognition', () => {
    it('stamps the marker and inserts the items in one transaction', async () => {
      mock.importJob.updateMany.mockResolvedValue({ count: 1 });
      mock.recognizedItem.createMany.mockResolvedValue({ count: 2 });

      const written = await service.saveRecognition(1, [
        { title: 'A', edition: null, platform: 'PS5', confidence: 0.9 },
        { title: 'B', edition: 'GOTY', platform: null, confidence: 0.5 },
      ]);

      expect(mock.importJob.updateMany).toHaveBeenCalledWith({
        where: { id: 1, visionCompletedAt: null },
        data: { visionCompletedAt: expect.any(Date) as Date },
      });
      expect(mock.recognizedItem.createMany).toHaveBeenCalledWith({
        data: [
          {
            importJobId: 1,
            position: 0,
            rawTitle: 'A',
            rawEdition: null,
            rawPlatform: 'PS5',
            confidence: 0.9,
            status: 'pending',
          },
          {
            importJobId: 1,
            position: 1,
            rawTitle: 'B',
            rawEdition: 'GOTY',
            rawPlatform: null,
            confidence: 0.5,
            status: 'pending',
          },
        ],
        skipDuplicates: true,
      });
      expect(written).toBe(2);
    });

    it('writes nothing when the marker is already set (one-shot vision call)', async () => {
      mock.importJob.updateMany.mockResolvedValue({ count: 0 });

      const written = await service.saveRecognition(1, [
        { title: 'A', edition: null, platform: null, confidence: 1 },
      ]);

      expect(mock.recognizedItem.createMany).not.toHaveBeenCalled();
      expect(written).toBe(0);
    });

    it('still stamps the marker for an empty recognition', async () => {
      mock.importJob.updateMany.mockResolvedValue({ count: 1 });

      const written = await service.saveRecognition(1, []);

      expect(mock.recognizedItem.createMany).not.toHaveBeenCalled();
      expect(written).toBe(0);
    });
  });

  describe('listPendingRecognizedItems', () => {
    it('lists pending items in position order', async () => {
      mock.recognizedItem.findMany.mockResolvedValue([]);

      await service.listPendingRecognizedItems(1);

      expect(mock.recognizedItem.findMany).toHaveBeenCalledWith({
        where: { importJobId: 1, status: 'pending' },
        orderBy: { position: 'asc' },
        select: {
          id: true,
          position: true,
          rawTitle: true,
          rawEdition: true,
          rawPlatform: true,
          confidence: true,
          status: true,
        },
      });
    });
  });

  describe('summarizeRecognizedItems', () => {
    it('sums the status groups', async () => {
      mock.recognizedItem.groupBy.mockResolvedValue([
        { status: 'imported', _count: { _all: 3 } },
        { status: 'unrecognized', _count: { _all: 1 } },
        { status: 'pending', _count: { _all: 2 } },
      ]);

      await expect(service.summarizeRecognizedItems(1)).resolves.toEqual({
        recognizedCount: 6,
        importedCount: 3,
        unrecognizedCount: 1,
      });
    });
  });

  describe('resolvePlatformId', () => {
    interface PlatformRow {
      id: number;
      name: string;
      abbreviation: string | null;
      alternativeName: string | null;
      igdbId: number | null;
      aliases: { name: string }[];
    }

    function row(
      overrides: Partial<PlatformRow> & { id: number },
    ): PlatformRow {
      return {
        name: '',
        abbreviation: null,
        alternativeName: null,
        igdbId: null,
        aliases: [],
        ...overrides,
      };
    }

    it('matches the raw platform first with a single platform query (select includes aliases)', async () => {
      mock.platform.findMany.mockResolvedValue([
        // The old IGDB-id-first code would have picked this lower-id row for
        // the candidate's igdbId (130); the raw platform must win instead.
        row({
          id: 2,
          name: 'Nintendo Switch',
          abbreviation: 'NS',
          igdbId: 130,
        }),
        row({ id: 5, name: 'Xbox', abbreviation: 'XBOX', igdbId: 11 }),
      ]);

      await expect(
        service.resolvePlatformId(
          [{ igdbId: 130, name: 'Nintendo Switch', abbreviation: 'NS' }],
          'Xbox',
        ),
      ).resolves.toBe(5);
      expect(mock.platform.findMany).toHaveBeenCalledTimes(1);
      expect(mock.platform.findMany).toHaveBeenCalledWith({
        orderBy: { id: 'asc' },
        select: {
          id: true,
          name: true,
          abbreviation: true,
          alternativeName: true,
          igdbId: true,
          aliases: { select: { name: true } },
        },
      });
      expect(platforms.createFromImport).not.toHaveBeenCalled();
    });

    it('matches the raw platform before any candidate, even a lower-id candidate', async () => {
      mock.platform.findMany.mockResolvedValue([
        row({
          id: 2,
          name: 'Nintendo Switch',
          abbreviation: 'NS',
          igdbId: 130,
        }),
        row({
          id: 9,
          name: 'PC (Microsoft Windows)',
          abbreviation: 'PC',
          igdbId: 6,
        }),
      ]);

      await expect(
        service.resolvePlatformId(
          [
            { igdbId: 130, name: 'Nintendo Switch', abbreviation: 'NS' },
            { igdbId: 6, name: 'PC (Microsoft Windows)', abbreviation: 'PC' },
          ],
          'PC DVD ROM',
        ),
      ).resolves.toBe(9);
      expect(platforms.createFromImport).not.toHaveBeenCalled();
    });

    it('creates a platform from the photo string when the raw platform matches nothing', async () => {
      mock.platform.findMany.mockResolvedValue([
        row({
          id: 2,
          name: 'Nintendo Switch',
          abbreviation: 'NS',
          igdbId: 130,
        }),
      ]);
      platforms.createFromImport.mockResolvedValue(77);

      await expect(
        service.resolvePlatformId(
          [{ igdbId: 130, name: 'Nintendo Switch', abbreviation: 'NS' }],
          'Sega Saturn',
        ),
      ).resolves.toBe(77);
      expect(platforms.createFromImport).toHaveBeenCalledWith('Sega Saturn');
    });

    it('matches the candidate name when the raw platform is blank', async () => {
      mock.platform.findMany.mockResolvedValue([
        row({ id: 9, name: 'Nintendo Switch', abbreviation: 'NS' }),
      ]);

      await expect(
        service.resolvePlatformId(
          [{ igdbId: 130, name: 'Nintendo Switch', abbreviation: 'NS' }],
          null,
        ),
      ).resolves.toBe(9);
      expect(platforms.createFromImport).not.toHaveBeenCalled();
    });

    it('falls back to the first candidate IGDB id in catalog order when no name matches', async () => {
      mock.platform.findMany.mockResolvedValue([
        row({
          id: 2,
          name: 'Nintendo Switch',
          abbreviation: 'NS',
          igdbId: 130,
        }),
        row({
          id: 9,
          name: 'PC (Microsoft Windows)',
          abbreviation: 'PC',
          igdbId: 6,
        }),
      ]);

      await expect(
        service.resolvePlatformId(
          [
            { igdbId: 6, name: 'Personal Computer', abbreviation: 'PC-98' },
            { igdbId: 130, name: 'Switch', abbreviation: 'NX' },
          ],
          null,
        ),
      ).resolves.toBe(9);
      expect(platforms.createFromImport).not.toHaveBeenCalled();
    });

    it("matches rawPlatform 'PS5' against a platform abbreviation", async () => {
      mock.platform.findMany.mockResolvedValue([
        row({ id: 9, name: 'PlayStation 5', abbreviation: 'PS5' }),
      ]);

      await expect(service.resolvePlatformId([], 'PS5')).resolves.toBe(9);
      expect(mock.platform.findMany).toHaveBeenCalledTimes(1);
    });

    it('matches candidate abbreviations', async () => {
      mock.platform.findMany.mockResolvedValue([
        row({ id: 9, name: 'PlayStation 5', abbreviation: 'PS5' }),
      ]);

      await expect(
        service.resolvePlatformId(
          [{ igdbId: 99, name: 'Sony PlayStation 5', abbreviation: 'PS5' }],
          null,
        ),
      ).resolves.toBe(9);
    });

    it('matches through an alias', async () => {
      mock.platform.findMany.mockResolvedValue([
        row({
          id: 9,
          name: 'PlayStation 5',
          abbreviation: 'PS5',
          aliases: [{ name: 'PlayStaton 5' }],
        }),
      ]);

      await expect(service.resolvePlatformId([], 'PlayStaton 5')).resolves.toBe(
        9,
      );
      expect(platforms.createFromImport).not.toHaveBeenCalled();
    });

    it('is case- and punctuation-insensitive', async () => {
      mock.platform.findMany.mockResolvedValue([
        row({ id: 9, name: 'PlayStation 5', abbreviation: 'PS5' }),
      ]);

      await expect(
        service.resolvePlatformId([], 'playstation-5'),
      ).resolves.toBe(9);
    });

    it('creates an import platform for an unknown named platform', async () => {
      mock.platform.findMany.mockResolvedValue([row({ id: 1, name: 'PC' })]);
      platforms.createFromImport.mockResolvedValue(77);

      await expect(service.resolvePlatformId([], 'Atari Jaguar')).resolves.toBe(
        77,
      );
      expect(platforms.createFromImport).toHaveBeenCalledWith('Atari Jaguar');
    });

    it('creates from the first candidate name when the raw platform is unusable', async () => {
      mock.platform.findMany.mockResolvedValue([row({ id: 1, name: 'PC' })]);
      platforms.createFromImport.mockResolvedValue(88);

      await expect(
        service.resolvePlatformId(
          [{ igdbId: 99, name: 'Atari Jaguar', abbreviation: 'JAG' }],
          '   ',
        ),
      ).resolves.toBe(88);
      expect(platforms.createFromImport).toHaveBeenCalledWith('Atari Jaguar');
    });

    it('returns null when there is no usable platform name', async () => {
      mock.platform.findMany.mockResolvedValue([row({ id: 1, name: 'PC' })]);

      await expect(
        service.resolvePlatformId(
          [{ igdbId: 99, name: '!!!', abbreviation: '???' }],
          '   ',
        ),
      ).resolves.toBeNull();
      expect(platforms.createFromImport).not.toHaveBeenCalled();
    });

    it('does not match a near-miss; it creates the named platform instead', async () => {
      mock.platform.findMany.mockResolvedValue([
        row({ id: 9, name: 'PlayStation 5', abbreviation: 'PS5' }),
      ]);
      platforms.createFromImport.mockResolvedValue(66);

      await expect(
        service.resolvePlatformId(
          [{ igdbId: 99, name: 'PlayStation 4', abbreviation: 'PS4' }],
          'PS4',
        ),
      ).resolves.toBe(66);
      expect(platforms.createFromImport).toHaveBeenCalledWith('PS4');
    });
  });

  describe('commitImportBatch', () => {
    const candidate = {
      externalId: 7,
      title: 'Halo',
      releaseYear: 2001,
      publisher: 'Bungie',
      genre: 'Shooter',
      playerCount: 16,
      coverUrl: 'https://images.igdb.com/halo.jpg',
      images: [],
      platforms: [],
      source: 'IGDB' as const,
      raw: { id: 7 },
    };

    /** What the enrichment service returns; `game.create` must receive it. */
    const enriched = {
      title: 'Halo',
      platformId: 3,
      edition: 'GOTY',
      releaseYear: 2001,
      publisher: 'Bungie',
      genre: 'Shooter',
      playerCount: 16,
      coverUrl: '/api/covers/0123456789abcdef0123456789abcdef.jpg',
      sourceCoverUrl: 'https://images.igdb.com/halo.jpg',
      images: [],
      rawMetadata: JSON.stringify({ id: 7 }),
      enrichedAt: new Date('2026-10-07T00:00:00.000Z'),
      source: 'IGDB' as const,
      externalId: 7,
    };

    it('creates a game and claims the recognized item in one transaction', async () => {
      enrichment.enrichCandidate.mockResolvedValue(enriched);
      mock.game.create.mockResolvedValue({ id: 42 });
      mock.recognizedItem.updateMany.mockResolvedValue({ count: 1 });

      await service.commitImportBatch(5, {
        resolved: [
          { recognizedItemId: 1, platformId: 3, edition: 'GOTY', candidate },
        ],
        unrecognized: [],
        transient: [],
      });

      // The candidate is mapped (and its cover cached) by the enrichment
      // service; `game.create` persists exactly the returned data.
      expect(enrichment.enrichCandidate).toHaveBeenCalledWith(
        candidate,
        3,
        'GOTY',
      );
      expect(mock.$transaction).toHaveBeenCalledTimes(1);
      expect(mock.game.create).toHaveBeenCalledWith({
        data: { ...enriched, images: { create: [] } },
      });
      expect(mock.recognizedItem.updateMany).toHaveBeenCalledWith({
        where: { id: 1, importJobId: 5, status: 'pending' },
        data: { status: 'imported', gameId: 42 },
      });
    });

    it('creates the game with source MobyGames for a fallback candidate', async () => {
      const mobyCandidate = {
        ...candidate,
        source: 'MobyGames' as const,
      };
      enrichment.enrichCandidate.mockResolvedValue({
        ...enriched,
        source: 'MobyGames' as const,
      });
      mock.game.create.mockResolvedValue({ id: 43 });
      mock.recognizedItem.updateMany.mockResolvedValue({ count: 1 });

      await service.commitImportBatch(5, {
        resolved: [
          {
            recognizedItemId: 1,
            platformId: 3,
            edition: null,
            candidate: mobyCandidate,
          },
        ],
        unrecognized: [],
        transient: [],
      });

      expect(enrichment.enrichCandidate).toHaveBeenCalledWith(
        mobyCandidate,
        3,
        null,
      );
      expect(mock.game.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ source: 'MobyGames' }) as unknown,
      });
    });

    it('links an already-catalogued identity without creating a row or incrementing copies', async () => {
      enrichment.enrichCandidate.mockResolvedValue(enriched);
      identity.findExisting.mockResolvedValue({ id: 77, copyCount: 1 });
      mock.recognizedItem.updateMany.mockResolvedValue({ count: 1 });

      await service.commitImportBatch(5, {
        resolved: [
          { recognizedItemId: 1, platformId: 3, edition: 'GOTY', candidate },
        ],
        unrecognized: [],
        transient: [],
      });

      // The identity lookup uses the enriched row's identity and the transaction.
      expect(identity.findExisting).toHaveBeenCalledWith(
        {
          title: 'Halo',
          platformId: 3,
          edition: 'GOTY',
          source: 'IGDB',
          externalId: 7,
        },
        mock,
      );
      // No second catalog row; the recognized item links to the existing game.
      expect(mock.game.create).not.toHaveBeenCalled();
      expect(mock.recognizedItem.updateMany).toHaveBeenCalledWith({
        where: { id: 1, importJobId: 5, status: 'pending' },
        data: { status: 'imported', gameId: 77 },
      });
      // The downloaded candidate cover was not adopted and is cleaned up.
      expect(maintenance.removeIfUnreferenced).toHaveBeenCalledWith(
        enriched.coverUrl,
      );
    });

    it('threads the candidate gallery into a nested create', async () => {
      const galleryEnriched = {
        ...enriched,
        images: [
          {
            url: '/api/covers/art.jpg',
            sourceUrl:
              'https://images.igdb.com/igdb/image/upload/t_1080p/art.jpg',
          },
        ],
      };
      enrichment.enrichCandidate.mockResolvedValue(galleryEnriched);
      mock.game.create.mockResolvedValue({ id: 42 });
      mock.recognizedItem.updateMany.mockResolvedValue({ count: 1 });

      await service.commitImportBatch(5, {
        resolved: [
          { recognizedItemId: 1, platformId: 3, edition: 'GOTY', candidate },
        ],
        unrecognized: [],
        transient: [],
      });

      expect(mock.game.create).toHaveBeenCalledWith({
        data: {
          ...galleryEnriched,
          images: {
            create: [
              {
                position: 0,
                url: '/api/covers/art.jpg',
                sourceUrl:
                  'https://images.igdb.com/igdb/image/upload/t_1080p/art.jpg',
              },
            ],
          },
        },
      });
    });

    it('cleans up downloaded gallery files for a duplicate item', async () => {
      const galleryEnriched = {
        ...enriched,
        images: [
          { url: '/api/covers/art.jpg', sourceUrl: 'https://x/art.jpg' },
          { url: '/api/covers/shot.jpg', sourceUrl: 'https://x/shot.jpg' },
        ],
      };
      enrichment.enrichCandidate.mockResolvedValue(galleryEnriched);
      identity.findExisting.mockResolvedValue({ id: 77, copyCount: 1 });
      mock.recognizedItem.updateMany.mockResolvedValue({ count: 1 });

      await service.commitImportBatch(5, {
        resolved: [
          { recognizedItemId: 1, platformId: 3, edition: 'GOTY', candidate },
        ],
        unrecognized: [],
        transient: [],
      });

      expect(mock.game.create).not.toHaveBeenCalled();
      expect(maintenance.removeIfUnreferenced).toHaveBeenCalledWith(
        galleryEnriched.coverUrl,
      );
      expect(maintenance.removeIfUnreferenced).toHaveBeenCalledWith(
        '/api/covers/art.jpg',
      );
      expect(maintenance.removeIfUnreferenced).toHaveBeenCalledWith(
        '/api/covers/shot.jpg',
      );
    });

    it('rolls the batch back when the item was already resolved', async () => {
      enrichment.enrichCandidate.mockResolvedValue(enriched);
      mock.game.create.mockResolvedValue({ id: 42 });
      mock.recognizedItem.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.commitImportBatch(5, {
          resolved: [
            { recognizedItemId: 1, platformId: 3, edition: null, candidate },
          ],
          unrecognized: [],
          transient: [],
        }),
      ).rejects.toThrow(RetryableImportError);
    });

    it('refuses to commit a batch once the job is terminal (abandoned attempt)', async () => {
      mock.importJob.findUnique.mockResolvedValue({ status: 'failed' });

      await expect(
        service.commitImportBatch(5, {
          resolved: [
            { recognizedItemId: 1, platformId: 3, edition: null, candidate },
          ],
          unrecognized: [],
          transient: [],
        }),
      ).rejects.toThrow(RetryableImportError);

      // The guard fires before any cover download or catalog write.
      expect(enrichment.enrichCandidate).not.toHaveBeenCalled();
      expect(mock.game.create).not.toHaveBeenCalled();
      expect(mock.recognizedItem.updateMany).not.toHaveBeenCalled();
    });

    it('records an unrecognized item and marks the recognized item', async () => {
      mock.unrecognizedItem.create.mockResolvedValue({ id: 9 });
      mock.recognizedItem.updateMany.mockResolvedValue({ count: 1 });

      await service.commitImportBatch(5, {
        resolved: [],
        unrecognized: [
          {
            recognizedItemId: 2,
            rawTitle: 'Mystery',
            rawPlatform: 'PS4',
            reason: 'no match',
          },
        ],
        transient: [],
      });

      expect(mock.recognizedItem.updateMany).toHaveBeenCalledWith({
        where: { id: 2, importJobId: 5, status: 'pending' },
        data: { status: 'unrecognized', reason: 'no match' },
      });
      expect(mock.unrecognizedItem.create).toHaveBeenCalledWith({
        data: {
          importJobId: 5,
          rawTitle: 'Mystery',
          rawPlatform: 'PS4',
          reason: 'no match',
        },
      });
    });

    it('does not create a second UnrecognizedItem when the item was already flagged', async () => {
      mock.unrecognizedItem.create.mockResolvedValue({ id: 9 });
      mock.recognizedItem.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.commitImportBatch(5, {
          resolved: [],
          unrecognized: [
            {
              recognizedItemId: 2,
              rawTitle: 'Mystery',
              rawPlatform: 'PS4',
              reason: 'no match',
            },
          ],
          transient: [],
        }),
      ).rejects.toThrow('already resolved');

      expect(mock.unrecognizedItem.create).not.toHaveBeenCalled();
    });
  });

  describe('retryJob', () => {
    it('resets the failed row and enqueues a new BullMQ unit', async () => {
      const resetJob = {
        ...JOB,
        status: 'queued',
        photoRef: 'p.png',
        declaredCount: 2,
        completedAt: null,
      };
      mock.importJob.findUnique
        .mockResolvedValueOnce({
          id: 1,
          status: 'failed',
          photoRef: 'p.png',
          declaredCount: 2,
        })
        .mockResolvedValueOnce(resetJob);
      mock.importJob.updateMany.mockResolvedValue({ count: 1 });
      queue.add.mockResolvedValue({ id: '9' });
      mock.importJob.update.mockResolvedValue(resetJob);

      const result = await service.retryJob(1);

      expect(mock.importJob.updateMany).toHaveBeenCalledWith({
        where: { id: 1, status: 'failed', photoRef: { not: null } },
        data: {
          status: 'queued',
          errorMessage: null,
          completedAt: null,
          enqueuedAt: expect.any(Date) as Date,
        },
      });
      expect(queue.add).toHaveBeenCalledWith('photo', {
        photoRef: 'p.png',
        declaredCount: 2,
        importJobId: 1,
      });
      expect(mock.importJob.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { bullJobId: '9' },
      });
      expect(result).toMatchObject({ id: 1, status: 'queued' });
    });

    it('409s when the guarded reset matches no row, without enqueueing', async () => {
      mock.importJob.findUnique
        .mockResolvedValueOnce({
          id: 1,
          status: 'failed',
          photoRef: 'p.png',
          declaredCount: null,
        })
        // The follow-up read distinguishes a lost race from a swept photo.
        .mockResolvedValueOnce({ status: 'queued', photoRef: 'p.png' });
      mock.importJob.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.retryJob(1)).rejects.toThrow(
        new ConflictException('Import job 1 is no longer failed'),
      );
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('409s when the race lost because the sweep cleared the photoRef', async () => {
      mock.importJob.findUnique
        .mockResolvedValueOnce({
          id: 1,
          status: 'failed',
          photoRef: 'p.png',
          declaredCount: null,
        })
        .mockResolvedValueOnce({ status: 'failed', photoRef: null });
      mock.importJob.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.retryJob(1)).rejects.toThrow(
        new ConflictException('This import has no photo to re-process'),
      );
      expect(queue.add).not.toHaveBeenCalled();
    });

    it.each(['queued', 'processing', 'done', 'needs_attention', 'dismissed'])(
      '409s for a %s job without enqueueing',
      async (status) => {
        mock.importJob.findUnique.mockResolvedValueOnce({
          id: 1,
          status,
          photoRef: 'p.png',
          declaredCount: null,
        });

        await expect(service.retryJob(1)).rejects.toThrow(ConflictException);
        expect(mock.importJob.updateMany).not.toHaveBeenCalled();
        expect(queue.add).not.toHaveBeenCalled();
      },
    );

    it('409s for a failed job with no stored photo', async () => {
      mock.importJob.findUnique.mockResolvedValueOnce({
        id: 1,
        status: 'failed',
        photoRef: null,
        declaredCount: null,
      });

      await expect(service.retryJob(1)).rejects.toThrow(ConflictException);
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('404s for an unknown job', async () => {
      mock.importJob.findUnique.mockResolvedValueOnce(null);

      await expect(service.retryJob(9)).rejects.toThrow(
        new NotFoundException('Import job with id 9 not found'),
      );
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('marks the row failed and 503s when enqueueing fails after the reset', async () => {
      mock.importJob.findUnique
        .mockResolvedValueOnce({
          id: 1,
          status: 'failed',
          photoRef: 'p.png',
          declaredCount: null,
        })
        // markFailed -> assertTransition reloads the (now queued) row.
        .mockResolvedValueOnce({
          id: 1,
          status: 'queued',
          declaredCount: null,
        });
      mock.importJob.updateMany.mockResolvedValue({ count: 1 });
      queue.add.mockRejectedValue(new Error('redis down'));

      await expect(service.retryJob(1)).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(mock.importJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'failed',
            errorMessage: 'Failed to enqueue the import job',
          }) as Record<string, unknown>,
        }),
      );
    });

    it('still returns the detail when the bullJobId write fails after enqueue', async () => {
      const resetJob = {
        ...JOB,
        status: 'queued',
        photoRef: 'p.png',
        declaredCount: 2,
        completedAt: null,
      };
      mock.importJob.findUnique
        .mockResolvedValueOnce({
          id: 1,
          status: 'failed',
          photoRef: 'p.png',
          declaredCount: 2,
        })
        .mockResolvedValueOnce(resetJob);
      mock.importJob.updateMany.mockResolvedValue({ count: 1 });
      queue.add.mockResolvedValue({ id: '9' });
      mock.importJob.update.mockRejectedValue(new Error('db down'));

      const result = await service.retryJob(1);

      expect(queue.add).toHaveBeenCalled();
      // The bullJobId write is the only update: markFailed never ran, so the
      // row was not forced back to failed.
      expect(mock.importJob.update).toHaveBeenCalledTimes(1);
      expect(mock.importJob.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { bullJobId: '9' },
      });
      expect(result).toMatchObject({ id: 1, status: 'queued' });
    });
  });

  describe('getBatchProgress', () => {
    it('aggregates statuses into the X-of-Y model', async () => {
      mock.importJob.groupBy.mockResolvedValue([
        { status: 'queued', _count: { _all: 2 } },
        { status: 'processing', _count: { _all: 1 } },
        { status: 'done', _count: { _all: 3 } },
        { status: 'needs_attention', _count: { _all: 1 } },
        { status: 'failed', _count: { _all: 1 } },
        { status: 'dismissed', _count: { _all: 2 } },
      ]);

      const result = await service.getBatchProgress('b1');

      expect(mock.importJob.groupBy).toHaveBeenCalledWith({
        by: ['status'],
        where: { batchId: 'b1' },
        _count: { _all: true },
      });
      expect(result).toEqual({
        batchId: 'b1',
        total: 10,
        queued: 2,
        processing: 1,
        done: 3,
        needsAttention: 1,
        failed: 1,
        dismissed: 2,
        completedCount: 7,
        pendingCount: 3,
        allCompleted: false,
        paused: false,
        pauseReason: null,
        pauseSource: null,
      });
    });

    it('404s for a batch with no rows', async () => {
      mock.importJob.groupBy.mockResolvedValue([]);

      await expect(service.getBatchProgress('nope')).rejects.toThrow(
        new NotFoundException('Import batch nope not found'),
      );
    });

    it('surfaces the pause state from QueueControlService', async () => {
      mock.importJob.groupBy.mockResolvedValue([
        { status: 'queued', _count: { _all: 2 } },
      ]);
      const pausedAt = new Date('2026-10-07T00:00:00.000Z');
      queueControl.getState.mockResolvedValue({
        paused: true,
        reason: 'IGDB rejected the credentials',
        source: 'igdb',
        pausedAt,
      });

      const result = await service.getBatchProgress('b1');

      expect(result).toMatchObject({
        paused: true,
        pauseReason: 'IGDB rejected the credentials',
        pauseSource: 'igdb',
      });
    });
  });

  describe('resumeQueue', () => {
    it('resumes the queue and returns the new state', async () => {
      queueControl.getState.mockResolvedValue({
        paused: false,
        reason: null,
        source: null,
        pausedAt: null,
      });

      const result = await service.resumeQueue();

      expect(queueControl.resume).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        paused: false,
        reason: null,
        source: null,
        pausedAt: null,
      });
    });
  });

  describe('live state merge (list/findOne)', () => {
    const queuedRow = {
      ...JOB,
      status: 'queued',
      declaredCount: null,
      recognizedCount: 0,
      importedCount: 0,
      unrecognizedCount: 0,
      completedAt: null,
      bullJobId: '42',
    };

    it('merges an active BullMQ state into processing for a queued row', async () => {
      mock.importJob.findMany.mockResolvedValue([queuedRow]);
      mock.importJob.count.mockResolvedValue(1);
      queue.getJob.mockResolvedValue({
        getState: jest.fn().mockResolvedValue('active'),
      });

      const result = await service.list({});

      expect(queue.getJob).toHaveBeenCalledWith('42');
      expect(result.items[0]).toMatchObject({
        status: 'processing',
        queueState: 'active',
      });
    });

    it('keeps the durable status and a null queueState when Redis fails', async () => {
      mock.importJob.findMany.mockResolvedValue([queuedRow]);
      mock.importJob.count.mockResolvedValue(1);
      queue.getJob.mockRejectedValue(new Error('redis down'));

      const result = await service.list({});

      expect(result.items[0]).toMatchObject({
        status: 'queued',
        queueState: null,
      });
    });

    it('keeps the durable status and a null queueState when Redis is slow', async () => {
      jest.useFakeTimers();
      try {
        mock.importJob.findMany.mockResolvedValue([queuedRow]);
        mock.importJob.count.mockResolvedValue(1);
        // Never settles: only the read timeout can release the request.
        queue.getJob.mockReturnValue(
          new Promise(() => {
            /* deliberately never resolves */
          }),
        );

        const pending = service.list({});
        await jest.advanceTimersByTimeAsync(IMPORT_QUEUE_STATE_TIMEOUT_MS + 1);
        const result = await pending;

        expect(result.items[0]).toMatchObject({
          status: 'queued',
          queueState: null,
        });
      } finally {
        jest.useRealTimers();
      }
    });

    it('never reads Redis for a terminal row and reports a null queueState', async () => {
      const terminalRow = {
        ...JOB,
        status: 'done',
        bullJobId: '99',
      };
      mock.importJob.findMany.mockResolvedValue([terminalRow]);
      mock.importJob.count.mockResolvedValue(1);

      const result = await service.list({});

      expect(queue.getJob).not.toHaveBeenCalled();
      expect(result.items[0]).toMatchObject({
        status: 'done',
        queueState: null,
      });
    });

    it('computes live counts for a non-terminal job', async () => {
      mock.importJob.findUnique.mockResolvedValue(queuedRow);
      mock.recognizedItem.groupBy.mockResolvedValue([
        { importJobId: 1, status: 'imported', _count: { _all: 2 } },
        { importJobId: 1, status: 'pending', _count: { _all: 3 } },
      ]);
      queue.getJob.mockResolvedValue({
        getState: jest.fn().mockResolvedValue('waiting'),
      });

      const result = await service.findOne(1);

      expect(result).toMatchObject({
        status: 'queued',
        queueState: 'waiting',
        recognizedCount: 5,
        importedCount: 2,
        unrecognizedCount: 0,
        pendingCount: 3,
        needsAttention: false,
      });
      expect(mock.recognizedItem.groupBy).toHaveBeenCalledWith({
        by: ['importJobId', 'status'],
        where: { importJobId: { in: [1] } },
        _count: { _all: true },
      });
    });
  });
});
