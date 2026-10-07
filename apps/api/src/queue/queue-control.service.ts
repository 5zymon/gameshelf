import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import type { ConfigErrorSource } from './photo-import.types';
import { PHOTO_IMPORT_QUEUE } from './queue.constants';

/** Fail fast instead of hanging a read request when Redis is unreachable. */
export const QUEUE_PAUSE_TIMEOUT_MS = 2_000;
/** Fallback reason when Redis says paused but no durable reason was recorded. */
export const DEFAULT_PAUSE_REASON =
  'Photo import is paused until the configuration is fixed';

export interface ImportQueueState {
  paused: boolean;
  reason: string | null;
  source: ConfigErrorSource | null;
  pausedAt: Date | null;
}

const SINGLETON_ID = 1;

@Injectable()
export class QueueControlService {
  private readonly logger = new Logger(QueueControlService.name);

  constructor(
    @InjectQueue(PHOTO_IMPORT_QUEUE) private readonly queue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  /** Pause on a config error and persist why (idempotent; latest reason wins). */
  async pauseForConfig(
    source: ConfigErrorSource,
    reason: string,
  ): Promise<void> {
    const pausedAt = new Date();
    await this.queue.pause();
    await this.prisma.importQueueState.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, paused: true, reason, source, pausedAt },
      update: { paused: true, reason, source, pausedAt },
    });
  }

  /** Resume the queue and clear the stored reason (idempotent). */
  async resume(): Promise<void> {
    await this.queue.resume();
    await this.prisma.importQueueState.upsert({
      where: { id: SINGLETON_ID },
      create: {
        id: SINGLETON_ID,
        paused: false,
        reason: null,
        source: null,
        pausedAt: null,
      },
      update: { paused: false, reason: null, source: null, pausedAt: null },
    });
  }

  /** Resume only when the queue is paused for `source`; returns whether it did. */
  async resumeIfPausedBy(source: ConfigErrorSource): Promise<boolean> {
    const state = await this.getState();
    if (!state.paused || state.source !== source) return false;
    await this.resume();
    return true;
  }

  /**
   * Operational truth: BullMQ `isPaused()` (Redis), with the durable row as the
   * reason store and as a fallback when Redis cannot be reached.
   */
  async getState(): Promise<ImportQueueState> {
    const row = await this.prisma.importQueueState.findUnique({
      where: { id: SINGLETON_ID },
    });
    let paused = row?.paused ?? false;
    try {
      paused = await this.withTimeout(
        this.queue.isPaused(),
        QUEUE_PAUSE_TIMEOUT_MS,
      );
    } catch (error) {
      this.logger.warn(
        `Could not read the BullMQ pause state; using the durable record: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (!paused) {
      return { paused: false, reason: null, source: null, pausedAt: null };
    }
    return {
      paused: true,
      reason: row?.reason ?? DEFAULT_PAUSE_REASON,
      source: (row?.source as ConfigErrorSource | null) ?? null,
      pausedAt: row?.pausedAt ?? null,
    };
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error('Redis did not respond in time'));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
