import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { IMPORT_JOB_STATUSES } from '../import-jobs/dto/list-import-jobs-query.dto';

export interface ClaimedPhotoImport {
  id: string;
  photoRef: string | null;
  attempts: number;
}

export interface StalledPhotoImport {
  id: string;
  attempts: number;
}

/** Columns that make a row runnable now with a fresh attempt budget. Shared by createJob(enqueue) and retryJob. */
export function runnableNowData(now = new Date()): {
  attempts: number;
  nextRunAt: Date;
  leaseUntil: null;
} {
  return { attempts: 0, nextRunAt: now, leaseUntil: null };
}

/**
 * `YYYY-MM-DD HH:MM:SS.mmm` in UTC, the representation Prisma writes for
 * DATETIME(3). Used for the one raw comparison so it never depends on the
 * session time zone.
 */
export function toMysqlUtcDateTime(date: Date): string {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

/**
 * The `import_jobs` table IS the photo-import queue (ADR-005). This service owns
 * the claim/lease/retry queries; the in-process `PhotoImportWorker` drives it.
 */
@Injectable()
export class PhotoImportQueue {
  private readonly wakeListeners = new Set<() => void>();

  constructor(private readonly prisma: PrismaService) {}

  /** Registers a wake listener; returns the unsubscribe function. */
  onWake(listener: () => void): () => void {
    this.wakeListeners.add(listener);
    return () => {
      this.wakeListeners.delete(listener);
    };
  }

  /** Same-process signal after an enqueue/resume; synchronous, never throws. */
  wake(): void {
    for (const listener of this.wakeListeners) {
      listener();
    }
  }

  /**
   * One transaction: lock the oldest due queued row (SKIP LOCKED), mark it
   * processing with a lease, count the attempt. UUIDv7 ids sort by creation
   * time (ADR-006), so `ORDER BY id` stays FIFO.
   */
  async claimNext(
    leaseMs: number,
    now = new Date(),
  ): Promise<ClaimedPhotoImport | null> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM import_jobs
        WHERE status = 'queued' AND next_run_at <= ${toMysqlUtcDateTime(now)}
        ORDER BY id
        LIMIT 1
        FOR UPDATE SKIP LOCKED`;
      const first = rows[0];
      if (first === undefined) return null;
      return tx.importJob.update({
        where: { id: first.id },
        data: {
          status: 'processing',
          attempts: { increment: 1 },
          leaseUntil: new Date(now.getTime() + leaseMs),
        },
        select: { id: true, photoRef: true, attempts: true },
      });
    });
  }

  /** Drop the lease after an attempt ended (success or terminal failure). */
  async release(id: string): Promise<void> {
    await this.prisma.importJob.updateMany({
      where: { id },
      data: { leaseUntil: null },
    });
  }

  /**
   * processing → queued with next_run_at = now + delay. Guarded on status
   * 'processing' (a row the pipeline already marked failed stays failed).
   * Returns whether it re-queued.
   */
  async scheduleRetry(
    id: string,
    delayMs: number,
    now = new Date(),
  ): Promise<boolean> {
    const written = await this.prisma.importJob.updateMany({
      where: { id, status: 'processing' },
      data: {
        status: 'queued',
        nextRunAt: new Date(now.getTime() + delayMs),
        leaseUntil: null,
      },
    });
    return written.count === 1;
  }

  /** processing rows whose lease expired (NULL lease is never stalled). */
  async findStalled(now = new Date()): Promise<StalledPhotoImport[]> {
    return this.prisma.importJob.findMany({
      where: { status: 'processing', leaseUntil: { lt: now } },
      select: { id: true, attempts: true },
      orderBy: { id: 'asc' },
    });
  }

  /** Guarded re-queue of one stalled row (status processing AND lease still expired). */
  async requeueStalled(
    id: string,
    delayMs: number,
    now = new Date(),
  ): Promise<boolean> {
    const written = await this.prisma.importJob.updateMany({
      where: { id, status: 'processing', leaseUntil: { lt: now } },
      data: {
        status: 'queued',
        nextRunAt: new Date(now.getTime() + delayMs),
        leaseUntil: null,
      },
    });
    return written.count === 1;
  }

  /** GET /health/queue: one GROUP BY status, zero-filled over IMPORT_JOB_STATUSES. */
  async countByStatus(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const status of IMPORT_JOB_STATUSES) {
      counts[status] = 0;
    }
    const groups = await this.prisma.importJob.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    for (const group of groups) {
      counts[group.status] = group._count._all;
    }
    return counts;
  }
}
