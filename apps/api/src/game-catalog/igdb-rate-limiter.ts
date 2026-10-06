import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import {
  IGDB_MAX_CONCURRENT_REQUESTS,
  IGDB_MAX_QUEUED_REQUESTS,
  IGDB_MAX_REQUESTS_PER_SECOND,
  IGDB_RATE_WINDOW_MS,
} from './igdb.options';

export interface IgdbRateLimiterOptions {
  maxRequestsPerSecond?: number;
  maxConcurrent?: number;
  windowMs?: number;
  maxQueue?: number;
}

interface QueuedTask {
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

@Injectable()
export class IgdbRateLimiter implements OnModuleDestroy {
  private readonly maxRequestsPerSecond: number;
  private readonly maxConcurrent: number;
  private readonly windowMs: number;
  private readonly maxQueue: number;
  private readonly startTimestamps: number[] = [];
  private readonly queue: QueuedTask[] = [];
  private active = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(options: IgdbRateLimiterOptions = {}) {
    this.maxRequestsPerSecond =
      options.maxRequestsPerSecond ?? IGDB_MAX_REQUESTS_PER_SECOND;
    this.maxConcurrent = options.maxConcurrent ?? IGDB_MAX_CONCURRENT_REQUESTS;
    this.windowMs = options.windowMs ?? IGDB_RATE_WINDOW_MS;
    this.maxQueue = options.maxQueue ?? IGDB_MAX_QUEUED_REQUESTS;
  }

  /** Runs `run` once a slot + window permit; returns its result/rejection. */
  schedule<T>(run: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.queue.length >= this.maxQueue) {
        reject(new Error('IGDB rate limiter queue is full'));
        return;
      }
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

  private pump(): void {
    if (this.timer !== null) return; // a wake-up is already pending
    for (;;) {
      if (this.queue.length === 0) return;
      const now = Date.now();
      this.prune(now);
      if (this.active >= this.maxConcurrent) return;
      if (this.startTimestamps.length >= this.maxRequestsPerSecond) {
        const oldest = this.startTimestamps[0];
        if (oldest === undefined) return;
        const wait = oldest + this.windowMs - now;
        this.timer = setTimeout(
          () => {
            this.timer = null;
            this.pump();
          },
          Math.max(0, wait),
        );
        return;
      }
      const task = this.queue.shift();
      if (task === undefined) return;
      this.active += 1;
      this.startTimestamps.push(now);
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

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    let oldest = this.startTimestamps[0];
    while (oldest !== undefined && oldest <= cutoff) {
      this.startTimestamps.shift();
      oldest = this.startTimestamps[0];
    }
  }
}
