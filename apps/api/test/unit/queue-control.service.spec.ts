import type { PrismaService } from '../../src/prisma/prisma.service';
import type { PhotoImportQueue } from '../../src/queue/photo-import.queue';
import {
  DEFAULT_PAUSE_REASON,
  QueueControlService,
} from '../../src/queue/queue-control.service';

interface PrismaMock {
  importQueueState: {
    findUnique: jest.Mock;
    upsert: jest.Mock;
  };
}

function createService(): {
  service: QueueControlService;
  photoQueue: { wake: jest.Mock };
  prisma: PrismaMock;
} {
  const photoQueue = { wake: jest.fn() };
  const prisma: PrismaMock = {
    importQueueState: {
      findUnique: jest.fn(() => Promise.resolve(null)),
      upsert: jest.fn(() => Promise.resolve({})),
    },
  };
  return {
    service: new QueueControlService(
      prisma as unknown as PrismaService,
      photoQueue as unknown as PhotoImportQueue,
    ),
    photoQueue,
    prisma,
  };
}

describe('QueueControlService (unit)', () => {
  it('pauseForConfig upserts the durable reason and touches no queue', async () => {
    const { service, photoQueue, prisma } = createService();

    await service.pauseForConfig('igdb', 'IGDB rejected the credentials');

    expect(prisma.importQueueState.upsert).toHaveBeenCalledWith({
      where: { id: 1 },
      create: {
        id: 1,
        paused: true,
        reason: 'IGDB rejected the credentials',
        source: 'igdb',
        pausedAt: expect.any(Date) as unknown,
      },
      update: {
        paused: true,
        reason: 'IGDB rejected the credentials',
        source: 'igdb',
        pausedAt: expect.any(Date) as unknown,
      },
    });
    expect(photoQueue.wake).not.toHaveBeenCalled();
  });

  it('resume clears the stored reason and wakes the worker', async () => {
    const { service, photoQueue, prisma } = createService();

    await service.resume();

    expect(prisma.importQueueState.upsert).toHaveBeenCalledWith({
      where: { id: 1 },
      create: {
        id: 1,
        paused: false,
        reason: null,
        source: null,
        pausedAt: null,
      },
      update: {
        paused: false,
        reason: null,
        source: null,
        pausedAt: null,
      },
    });
    expect(photoQueue.wake).toHaveBeenCalledTimes(1);
  });

  it('getState reports paused with the durable reason', async () => {
    const { service, prisma } = createService();
    const pausedAt = new Date('2026-10-07T00:00:00.000Z');
    prisma.importQueueState.findUnique.mockResolvedValue({
      id: 1,
      paused: true,
      reason: 'IGDB rejected the credentials',
      source: 'igdb',
      pausedAt,
    });

    await expect(service.getState()).resolves.toEqual({
      paused: true,
      reason: 'IGDB rejected the credentials',
      source: 'igdb',
      pausedAt,
    });
  });

  it('getState uses the default reason for a paused row with a null reason', async () => {
    const { service, prisma } = createService();
    prisma.importQueueState.findUnique.mockResolvedValue({
      id: 1,
      paused: true,
      reason: null,
      source: null,
      pausedAt: null,
    });

    await expect(service.getState()).resolves.toEqual({
      paused: true,
      reason: DEFAULT_PAUSE_REASON,
      source: null,
      pausedAt: null,
    });
  });

  it('getState reports not paused when the row is running', async () => {
    const { service, prisma } = createService();
    prisma.importQueueState.findUnique.mockResolvedValue({
      id: 1,
      paused: false,
      reason: 'stale reason',
      source: 'igdb',
      pausedAt: new Date('2026-10-07T00:00:00.000Z'),
    });

    await expect(service.getState()).resolves.toEqual({
      paused: false,
      reason: null,
      source: null,
      pausedAt: null,
    });
  });

  it('getState reports not paused when no row exists', async () => {
    const { service, prisma } = createService();
    prisma.importQueueState.findUnique.mockResolvedValue(null);

    await expect(service.getState()).resolves.toEqual({
      paused: false,
      reason: null,
      source: null,
      pausedAt: null,
    });
  });

  describe('isPaused', () => {
    it('is true for a paused row', async () => {
      const { service, prisma } = createService();
      prisma.importQueueState.findUnique.mockResolvedValue({
        id: 1,
        paused: true,
      });

      await expect(service.isPaused()).resolves.toBe(true);
    });

    it('is false for a running row', async () => {
      const { service, prisma } = createService();
      prisma.importQueueState.findUnique.mockResolvedValue({
        id: 1,
        paused: false,
      });

      await expect(service.isPaused()).resolves.toBe(false);
    });

    it('is false when no row exists', async () => {
      const { service, prisma } = createService();
      prisma.importQueueState.findUnique.mockResolvedValue(null);

      await expect(service.isPaused()).resolves.toBe(false);
    });
  });

  describe('resumeIfPausedBy', () => {
    it('resumes when paused by the matching source', async () => {
      const { service, photoQueue, prisma } = createService();
      prisma.importQueueState.findUnique.mockResolvedValue({
        id: 1,
        paused: true,
        reason: 'The provider rejected the API key',
        source: 'llm',
        pausedAt: null,
      });

      await expect(service.resumeIfPausedBy('llm')).resolves.toBe(true);
      expect(prisma.importQueueState.upsert).toHaveBeenCalledTimes(1);
      expect(photoQueue.wake).toHaveBeenCalledTimes(1);
    });

    it('does nothing when paused by a different source', async () => {
      const { service, photoQueue, prisma } = createService();
      prisma.importQueueState.findUnique.mockResolvedValue({
        id: 1,
        paused: true,
        reason: 'IGDB rejected the credentials',
        source: 'igdb',
        pausedAt: null,
      });

      await expect(service.resumeIfPausedBy('llm')).resolves.toBe(false);
      expect(prisma.importQueueState.upsert).not.toHaveBeenCalled();
      expect(photoQueue.wake).not.toHaveBeenCalled();
    });

    it('does nothing when the queue is not paused', async () => {
      const { service, photoQueue } = createService();

      await expect(service.resumeIfPausedBy('llm')).resolves.toBe(false);
      expect(photoQueue.wake).not.toHaveBeenCalled();
    });
  });
});
