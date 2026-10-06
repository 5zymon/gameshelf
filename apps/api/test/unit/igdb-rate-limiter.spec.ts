import { IgdbRateLimiter } from '../../src/game-catalog/igdb-rate-limiter';
import {
  IGDB_MAX_CONCURRENT_REQUESTS,
  IGDB_MAX_REQUESTS_PER_SECOND,
} from '../../src/game-catalog/igdb.options';

describe('IgdbRateLimiter (unit)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('defaults to 4 requests per second and 8 concurrent', () => {
    const limiter = new IgdbRateLimiter();
    const internals = limiter as unknown as {
      maxRequestsPerSecond: number;
      maxConcurrent: number;
    };
    expect(internals.maxRequestsPerSecond).toBe(IGDB_MAX_REQUESTS_PER_SECOND);
    expect(internals.maxConcurrent).toBe(IGDB_MAX_CONCURRENT_REQUESTS);
  });

  it('never starts more than 4 requests in any one-second window', async () => {
    jest.useFakeTimers();
    const limiter = new IgdbRateLimiter({
      maxRequestsPerSecond: 4,
      maxConcurrent: 8,
      windowMs: 1000,
    });
    const starts: number[] = [];
    const tasks = Array.from({ length: 12 }, () =>
      limiter.schedule(() => {
        starts.push(Date.now());
        return Promise.resolve();
      }),
    );

    await jest.advanceTimersByTimeAsync(3000);
    await Promise.all(tasks);

    expect(starts).toHaveLength(12);
    for (const start of starts) {
      const inWindow = starts.filter(
        (other) => other > start - 1000 && other <= start,
      );
      expect(inWindow.length).toBeLessThanOrEqual(4);
    }
  });

  it('never runs more than 8 requests concurrently', async () => {
    const limiter = new IgdbRateLimiter({
      maxRequestsPerSecond: Number.MAX_SAFE_INTEGER,
      maxConcurrent: 8,
      windowMs: 1000,
    });
    let active = 0;
    let maxActive = 0;
    const releases: (() => void)[] = [];
    const tasks = Array.from({ length: 20 }, () =>
      limiter.schedule(
        () =>
          new Promise<void>((resolve) => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            releases.push(() => {
              active -= 1;
              resolve();
            });
          }),
      ),
    );

    // Let the microtask queue settle so `pump` fills every available slot.
    await Promise.resolve();
    await Promise.resolve();
    expect(releases).toHaveLength(8);

    while (releases.length > 0) {
      releases.shift()?.();
      await Promise.resolve();
      await Promise.resolve();
    }
    await Promise.all(tasks);

    expect(maxActive).toBe(8);
    expect(limiter.activeCount).toBe(0);
  });

  it('frees a slot when a task rejects and runs the next queued task', async () => {
    const limiter = new IgdbRateLimiter({ maxConcurrent: 1 });
    const first = limiter.schedule(() => Promise.reject(new Error('boom')));
    const second = limiter.schedule(() => Promise.resolve(2));

    await expect(first).rejects.toThrow('boom');
    await expect(second).resolves.toBe(2);
    expect(limiter.activeCount).toBe(0);
  });

  it('exposes activeCount while work is in flight', async () => {
    const limiter = new IgdbRateLimiter();
    let release!: () => void;
    const task = limiter.schedule(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    await Promise.resolve();
    expect(limiter.activeCount).toBe(1);

    release();
    await task;
    expect(limiter.activeCount).toBe(0);
  });

  it('rejects a schedule call when the queue is full and accepts again once drained', async () => {
    const limiter = new IgdbRateLimiter({ maxConcurrent: 1, maxQueue: 1 });
    let release!: () => void;
    const running = limiter.schedule(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await Promise.resolve();

    // The single queue slot is taken by this waiting task...
    const queued = limiter.schedule(() => Promise.resolve('queued'));
    // ...so the next one is rejected fast instead of growing the queue.
    await expect(
      limiter.schedule(() => Promise.resolve('rejected')),
    ).rejects.toThrow('IGDB rate limiter queue is full');

    release();
    await running;
    await expect(queued).resolves.toBe('queued');
    // Queue drained: scheduling works again.
    await expect(
      limiter.schedule(() => Promise.resolve('again')),
    ).resolves.toBe('again');
  });
});
