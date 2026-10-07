import { MobygamesRateLimiter } from '../../src/game-catalog/mobygames-rate-limiter';
import {
  MOBYGAMES_MAX_REQUESTS_PER_HOUR,
  MOBYGAMES_MAX_REQUESTS_PER_SECOND,
} from '../../src/game-catalog/mobygames.options';

describe('MobygamesRateLimiter (unit)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('defaults to 1 request/second and 720 requests/hour', () => {
    const limiter = new MobygamesRateLimiter();
    const internals = limiter as unknown as {
      maxRequestsPerSecond: number;
      maxRequestsPerHour: number;
      maxConcurrent: number;
    };
    expect(internals.maxRequestsPerSecond).toBe(
      MOBYGAMES_MAX_REQUESTS_PER_SECOND,
    );
    expect(internals.maxRequestsPerHour).toBe(MOBYGAMES_MAX_REQUESTS_PER_HOUR);
    expect(internals.maxConcurrent).toBe(1);
  });

  it('never starts more than 1 request in any one-second window', async () => {
    jest.useFakeTimers();
    const limiter = new MobygamesRateLimiter({
      maxRequestsPerSecond: 1,
      maxConcurrent: 1,
      secondWindowMs: 1000,
    });
    const starts: number[] = [];
    const tasks = Array.from({ length: 5 }, () =>
      limiter.schedule(() => {
        starts.push(Date.now());
        return Promise.resolve();
      }),
    );

    await jest.advanceTimersByTimeAsync(5000);
    await Promise.all(tasks);

    expect(starts).toHaveLength(5);
    for (const start of starts) {
      const inWindow = starts.filter(
        (other) => other > start - 1000 && other <= start,
      );
      expect(inWindow.length).toBeLessThanOrEqual(1);
    }
  });

  it('waits (does not reject or 429-retry) when the hourly budget would be breached', async () => {
    jest.useFakeTimers();
    const limiter = new MobygamesRateLimiter({
      maxRequestsPerSecond: Number.MAX_SAFE_INTEGER,
      maxRequestsPerHour: 3,
      hourWindowMs: 5000,
      maxConcurrent: 1,
    });
    const starts: number[] = [];
    const tasks = Array.from({ length: 4 }, () =>
      limiter.schedule(() => {
        starts.push(Date.now());
        return Promise.resolve();
      }),
    );

    await jest.advanceTimersByTimeAsync(5000);
    await Promise.all(tasks);

    // The first three start immediately; the fourth is held back until the
    // hourly window frees — it is never fired early and 429-retried.
    expect(starts).toHaveLength(4);
    expect(starts[3] ?? 0).toBeGreaterThanOrEqual(5000);
    await expect(tasks[3]).resolves.toBeUndefined();
  });

  it('never starts more than 720 requests in any rolling hour under load', async () => {
    jest.useFakeTimers();
    const limiter = new MobygamesRateLimiter();
    const starts: number[] = [];
    const tasks = Array.from({ length: 725 }, () =>
      limiter.schedule(() => {
        starts.push(Date.now());
        return Promise.resolve();
      }),
    );

    await jest.advanceTimersByTimeAsync(3_700_000);
    await Promise.all(tasks);

    expect(starts).toHaveLength(725);
    // The 721st start is pushed to the one-hour boundary of the first.
    expect(starts[720] ?? 0).toBeGreaterThanOrEqual(3_600_000);
    for (const start of starts) {
      const inSecond = starts.filter(
        (other) => other > start - 1000 && other <= start,
      );
      expect(inSecond.length).toBeLessThanOrEqual(1);
      const inHour = starts.filter(
        (other) => other > start - 3_600_000 && other <= start,
      );
      expect(inHour.length).toBeLessThanOrEqual(720);
    }
  });

  it('frees a slot when a task rejects and runs the next queued task', async () => {
    const limiter = new MobygamesRateLimiter({ maxConcurrent: 1 });
    const first = limiter.schedule(() => Promise.reject(new Error('boom')));
    const second = limiter.schedule(() => Promise.resolve(2));

    await expect(first).rejects.toThrow('boom');
    await expect(second).resolves.toBe(2);
    expect(limiter.activeCount).toBe(0);
  });

  it('exposes activeCount and queuedCount', async () => {
    const limiter = new MobygamesRateLimiter({ maxConcurrent: 1 });
    let release!: () => void;
    const task = limiter.schedule(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    await Promise.resolve();
    expect(limiter.activeCount).toBe(1);
    expect(limiter.queuedCount).toBe(0);

    const queued = limiter.schedule(() => Promise.resolve('next'));
    expect(limiter.queuedCount).toBe(1);

    release();
    await task;
    await expect(queued).resolves.toBe('next');
    expect(limiter.activeCount).toBe(0);
    expect(limiter.queuedCount).toBe(0);
  });

  it('cancels its pending wake-up on onModuleDestroy', async () => {
    jest.useFakeTimers();
    const limiter = new MobygamesRateLimiter({
      maxRequestsPerSecond: 1,
      secondWindowMs: 1000,
      maxConcurrent: 1,
    });
    let release!: () => void;
    const first = limiter.schedule(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await Promise.resolve();
    // Intentionally left queued: onModuleDestroy cancels its scheduled wake-up.
    void limiter.schedule(() => Promise.resolve());

    release();
    await Promise.resolve();
    await Promise.resolve();

    const internals = limiter as unknown as { timer: NodeJS.Timeout | null };
    expect(internals.timer).not.toBeNull();

    limiter.onModuleDestroy();
    expect(internals.timer).toBeNull();

    await first;
    expect(limiter.activeCount).toBe(0);
  });

  it('accepts an injected clock', async () => {
    jest.useFakeTimers();
    let clock = 0;
    const limiter = new MobygamesRateLimiter({
      maxRequestsPerSecond: 1,
      secondWindowMs: 1000,
      maxConcurrent: 1,
      now: () => clock,
    });
    const starts: number[] = [];
    const first = limiter.schedule(() => {
      starts.push(clock);
      return Promise.resolve();
    });
    await Promise.resolve();
    const second = limiter.schedule(() => {
      starts.push(clock);
      return Promise.resolve();
    });
    await Promise.resolve();
    expect(limiter.queuedCount).toBe(1);

    clock = 1000;
    await jest.advanceTimersByTimeAsync(1000);
    await Promise.all([first, second]);

    expect(starts).toEqual([0, 1000]);
  });
});
