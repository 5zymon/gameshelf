import { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { PrismaService } from '../../src/prisma/prisma.service';
import {
  DEFAULT_PAUSE_REASON,
  QueueControlService,
} from '../../src/queue/queue-control.service';

interface QueueMock {
  pause: jest.Mock;
  resume: jest.Mock;
  isPaused: jest.Mock;
}

interface PrismaMock {
  importQueueState: {
    findUnique: jest.Mock;
    upsert: jest.Mock;
  };
}

function createService(): {
  service: QueueControlService;
  queue: QueueMock;
  prisma: PrismaMock;
} {
  const queue: QueueMock = {
    pause: jest.fn(() => Promise.resolve()),
    resume: jest.fn(() => Promise.resolve()),
    isPaused: jest.fn(() => Promise.resolve(false)),
  };
  const prisma: PrismaMock = {
    importQueueState: {
      findUnique: jest.fn(() => Promise.resolve(null)),
      upsert: jest.fn(() => Promise.resolve({})),
    },
  };
  return {
    service: new QueueControlService(
      queue as unknown as Queue,
      prisma as unknown as PrismaService,
    ),
    queue,
    prisma,
  };
}

describe('QueueControlService (unit)', () => {
  it('pauseForConfig pauses the queue and upserts the durable reason', async () => {
    const { service, queue, prisma } = createService();

    await service.pauseForConfig('igdb', 'IGDB rejected the credentials');

    expect(queue.pause).toHaveBeenCalledTimes(1);
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
  });

  it('resume resumes the queue and clears the stored reason', async () => {
    const { service, queue, prisma } = createService();

    await service.resume();

    expect(queue.resume).toHaveBeenCalledTimes(1);
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
  });

  it('getState reports paused with the durable reason from Redis', async () => {
    const { service, queue, prisma } = createService();
    const pausedAt = new Date('2026-10-07T00:00:00.000Z');
    queue.isPaused.mockResolvedValue(true);
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

  it('getState reports not paused when Redis says running even if the row says paused', async () => {
    const { service, queue, prisma } = createService();
    queue.isPaused.mockResolvedValue(false);
    prisma.importQueueState.findUnique.mockResolvedValue({
      id: 1,
      paused: true,
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

  it('getState falls back to the durable row when isPaused rejects', async () => {
    const { service, queue, prisma } = createService();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    queue.isPaused.mockRejectedValue(new Error('redis down'));
    prisma.importQueueState.findUnique.mockResolvedValue({
      id: 1,
      paused: true,
      reason: 'The provider rejected the API key',
      source: 'llm',
      pausedAt: null,
    });

    await expect(service.getState()).resolves.toEqual({
      paused: true,
      reason: 'The provider rejected the API key',
      source: 'llm',
      pausedAt: null,
    });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('getState uses the default reason when Redis is paused but no row exists', async () => {
    const { service, queue, prisma } = createService();
    queue.isPaused.mockResolvedValue(true);
    prisma.importQueueState.findUnique.mockResolvedValue(null);

    await expect(service.getState()).resolves.toEqual({
      paused: true,
      reason: DEFAULT_PAUSE_REASON,
      source: null,
      pausedAt: null,
    });
  });

  describe('resumeIfPausedBy', () => {
    it('resumes when paused by the matching source', async () => {
      const { service, queue, prisma } = createService();
      queue.isPaused.mockResolvedValue(true);
      prisma.importQueueState.findUnique.mockResolvedValue({
        id: 1,
        paused: true,
        reason: 'The provider rejected the API key',
        source: 'llm',
        pausedAt: null,
      });

      await expect(service.resumeIfPausedBy('llm')).resolves.toBe(true);
      expect(queue.resume).toHaveBeenCalledTimes(1);
    });

    it('does nothing when paused by a different source', async () => {
      const { service, queue, prisma } = createService();
      queue.isPaused.mockResolvedValue(true);
      prisma.importQueueState.findUnique.mockResolvedValue({
        id: 1,
        paused: true,
        reason: 'IGDB rejected the credentials',
        source: 'igdb',
        pausedAt: null,
      });

      await expect(service.resumeIfPausedBy('llm')).resolves.toBe(false);
      expect(queue.resume).not.toHaveBeenCalled();
    });

    it('does nothing when the queue is not paused', async () => {
      const { service, queue } = createService();
      queue.isPaused.mockResolvedValue(false);

      await expect(service.resumeIfPausedBy('llm')).resolves.toBe(false);
      expect(queue.resume).not.toHaveBeenCalled();
    });
  });
});
