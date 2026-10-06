import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../src/generated/prisma/client';
import { ImportJobsService } from '../../src/import-jobs/import-jobs.service';
import type { PrismaService } from '../../src/prisma/prisma.service';

interface ImportJobsPrismaMock {
  importJob: {
    findMany: jest.Mock;
    count: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  unrecognizedItem: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
}

function createService(): {
  service: ImportJobsService;
  mock: ImportJobsPrismaMock;
} {
  const mock: ImportJobsPrismaMock = {
    importJob: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    unrecognizedItem: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
  return {
    service: new ImportJobsService(mock as unknown as PrismaService),
    mock,
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
  recognizedCount: 1,
  importedCount: 1,
  unrecognizedCount: 1,
  errorMessage: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  completedAt: new Date('2026-01-01T01:00:00.000Z'),
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

  beforeEach(() => {
    ({ service, mock } = createService());
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
      expect(result).toBe(JOB);
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
      expect(result).toBe(fullJob);
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
      expect(result).toBe(fullJob);
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
      expect(result).toBe(fullJob);
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
        data: { status: 'queued', declaredCount: null, photoRef: null },
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
        data: { status: 'queued', declaredCount: 12, photoRef: null },
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
        data: { status: 'queued', declaredCount: null, photoRef: 'abc.png' },
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
        data: { status: 'processing' },
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
        data: { status: 'processing' },
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
      mock.importJob.update.mockResolvedValue({ ...JOB, status: 'done' });

      await service.markCompleted(1, {
        recognizedCount: 2,
        importedCount: 2,
        unrecognizedCount: 0,
      });

      expect(mock.importJob.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          status: 'done',
          recognizedCount: 2,
          importedCount: 2,
          unrecognizedCount: 0,
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
      mock.importJob.update.mockResolvedValue({
        ...JOB,
        status: 'needs_attention',
      });

      await service.markCompleted(1, {
        recognizedCount: 0,
        importedCount: 0,
        unrecognizedCount: 0,
      });

      expect(mock.importJob.update).toHaveBeenCalledWith(
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
      mock.importJob.update.mockResolvedValue({
        ...JOB,
        status: 'needs_attention',
      });

      await service.markCompleted(1, {
        recognizedCount: 3,
        importedCount: 3,
        unrecognizedCount: 0,
      });

      expect(mock.importJob.update).toHaveBeenCalledWith(
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
      mock.importJob.update.mockResolvedValue({
        ...JOB,
        status: 'needs_attention',
      });

      await service.markCompleted(1, {
        recognizedCount: 3,
        importedCount: 2,
        unrecognizedCount: 1,
      });

      expect(mock.importJob.update).toHaveBeenCalledWith(
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
      expect(mock.importJob.update).not.toHaveBeenCalled();
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
      mock.importJob.update.mockResolvedValue({ ...JOB, status: 'failed' });

      await service.markFailed(1, 'LLM request timed out');

      expect(mock.importJob.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          status: 'failed',
          errorMessage: 'LLM request timed out',
          completedAt: expect.any(Date) as Date,
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
      expect(mock.importJob.update).not.toHaveBeenCalled();
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
});
