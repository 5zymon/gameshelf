import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { ConfigErrorSource } from './photo-import.types';
import { PhotoImportQueue } from './photo-import.queue';

/** Fallback reason when the row says paused but no durable reason was recorded. */
export const DEFAULT_PAUSE_REASON =
  'Photo import is paused until the configuration is fixed';

export interface ImportQueueState {
  paused: boolean;
  reason: string | null;
  source: ConfigErrorSource | null;
  pausedAt: Date | null;
}

const SINGLETON_ID = 1;

/**
 * The global photo-import pause (ticket 3.10). The MySQL `import_queue_state`
 * row is the single source of truth (ADR-005): the worker claims nothing while
 * `paused`. Resume wakes the worker so a paused-then-resumed queue drains
 * immediately.
 */
@Injectable()
export class QueueControlService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly photoQueue: PhotoImportQueue,
  ) {}

  /** Pause on a config error and persist why (idempotent; latest reason wins). */
  async pauseForConfig(
    source: ConfigErrorSource,
    reason: string,
  ): Promise<void> {
    const pausedAt = new Date();
    await this.prisma.importQueueState.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, paused: true, reason, source, pausedAt },
      update: { paused: true, reason, source, pausedAt },
    });
  }

  /** Resume the queue, clear the stored reason, and wake the worker (idempotent). */
  async resume(): Promise<void> {
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
    this.photoQueue.wake();
  }

  /** Resume only when the queue is paused for `source`; returns whether it did. */
  async resumeIfPausedBy(source: ConfigErrorSource): Promise<boolean> {
    const state = await this.getState();
    if (!state.paused || state.source !== source) return false;
    await this.resume();
    return true;
  }

  /** True when the durable pause row says the queue is paused. */
  async isPaused(): Promise<boolean> {
    const row = await this.prisma.importQueueState.findUnique({
      where: { id: SINGLETON_ID },
    });
    return row?.paused ?? false;
  }

  /** The durable pause state; a missing or running row reports not paused. */
  async getState(): Promise<ImportQueueState> {
    const row = await this.prisma.importQueueState.findUnique({
      where: { id: SINGLETON_ID },
    });
    if (!row?.paused) {
      return { paused: false, reason: null, source: null, pausedAt: null };
    }
    return {
      paused: true,
      reason: row.reason ?? DEFAULT_PAUSE_REASON,
      source: (row.source as ConfigErrorSource | null) ?? null,
      pausedAt: row.pausedAt,
    };
  }
}
