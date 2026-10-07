import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import {
  MOBYGAMES_HOUR_WINDOW_MS,
  MOBYGAMES_MAX_CONCURRENT_REQUESTS,
  MOBYGAMES_MAX_REQUESTS_PER_HOUR,
  MOBYGAMES_MAX_REQUESTS_PER_SECOND,
  MOBYGAMES_SECOND_WINDOW_MS,
} from './mobygames.options';

export interface MobygamesRateLimiterOptions {
  maxRequestsPerSecond?: number;
  maxRequestsPerHour?: number;
  secondWindowMs?: number;
  hourWindowMs?: number;
  maxConcurrent?: number;
  now?: () => number;
}

interface QueuedTask {
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

/**
 * Central MobyGames limiter (card 4.5). Enforces both a 1-request-per-rolling-
 * second cap and a hard 720-requests-per-rolling-hour budget. Unlike
 * `IgdbRateLimiter` it has **no queue-full rejection**: a task that would breach
 * the budget **waits** (its `schedule()` promise stays pending) instead of being
 * fired and 429-retried. The limiter is per process, like IGDB's.
 *
 * This is intentional and safe only because `PHOTO_IMPORT_CONCURRENCY = 1`
 * bounds the outstanding tasks: one import job resolves items sequentially, so
 * at most one MobyGames wait is ever pending per worker. If worker concurrency
 * is ever raised, the unbounded `queue` must gain a cap/rejection path like
 * `IgdbRateLimiter`, otherwise re-enqueueing retries could pile up.
 */
@Injectable()
export class MobygamesRateLimiter implements OnModuleDestroy {
  private readonly maxRequestsPerSecond: number;
  private readonly maxRequestsPerHour: number;
  private readonly secondWindowMs: number;
  private readonly hourWindowMs: number;
  private readonly maxConcurrent: number;
  private readonly now: () => number;
  private readonly secondStarts: number[] = [];
  private readonly hourStarts: number[] = [];
  private readonly queue: QueuedTask[] = [];
  private active = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(options: MobygamesRateLimiterOptions = {}) {
    this.maxRequestsPerSecond =
      options.maxRequestsPerSecond ?? MOBYGAMES_MAX_REQUESTS_PER_SECOND;
    this.maxRequestsPerHour =
      options.maxRequestsPerHour ?? MOBYGAMES_MAX_REQUESTS_PER_HOUR;
    this.secondWindowMs = options.secondWindowMs ?? MOBYGAMES_SECOND_WINDOW_MS;
    this.hourWindowMs = options.hourWindowMs ?? MOBYGAMES_HOUR_WINDOW_MS;
    this.maxConcurrent =
      options.maxConcurrent ?? MOBYGAMES_MAX_CONCURRENT_REQUESTS;
    this.now = options.now ?? ((): number => Date.now());
  }

  /** Runs `run` once both windows and a concurrency slot permit. */
  schedule<T>(run: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        run,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.pump();
    });
  }

  /** Cancels a pending wake-up so shutdown is not delayed by the limiter. */
  onModuleDestroy(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Observability/tests: requests currently in flight. */
  get activeCount(): number {
    return this.active;
  }

  /** Observability/tests: tasks waiting for a budget slot. */
  get queuedCount(): number {
    return this.queue.length;
  }

  private pump(): void {
    if (this.timer !== null) return; // a wake-up is already pending
    for (;;) {
      if (this.queue.length === 0) return;
      const now = this.now();
      this.prune(this.secondStarts, this.secondWindowMs, now);
      this.prune(this.hourStarts, this.hourWindowMs, now);
      if (this.active >= this.maxConcurrent) return;
      const wait = Math.max(
        waitMs(
          this.secondStarts,
          this.maxRequestsPerSecond,
          this.secondWindowMs,
          now,
        ),
        waitMs(
          this.hourStarts,
          this.maxRequestsPerHour,
          this.hourWindowMs,
          now,
        ),
      );
      if (wait > 0) {
        this.timer = setTimeout(() => {
          this.timer = null;
          this.pump();
        }, wait);
        return;
      }
      const task = this.queue.shift();
      if (task === undefined) return;
      this.active += 1;
      this.secondStarts.push(now);
      this.hourStarts.push(now);
      void this.runTask(task);
    }
  }

  private async runTask(task: QueuedTask): Promise<void> {
    try {
      task.resolve(await task.run());
    } catch (error) {
      task.reject(error);
    } finally {
      this.active -= 1;
      this.pump();
    }
  }

  private prune(starts: number[], windowMs: number, now: number): void {
    const cutoff = now - windowMs;
    let oldest = starts[0];
    while (oldest !== undefined && oldest <= cutoff) {
      starts.shift();
      oldest = starts[0];
    }
  }
}

/** Milliseconds until `starts` drops below `limit`, or 0 if a slot is free. */
function waitMs(
  starts: readonly number[],
  limit: number,
  windowMs: number,
  now: number,
): number {
  if (starts.length < limit) return 0;
  const oldest = starts[0];
  if (oldest === undefined) return 0;
  return Math.max(0, oldest + windowMs - now);
}
