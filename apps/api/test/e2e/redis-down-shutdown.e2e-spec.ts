import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

/**
 * Regression test for the graceful-shutdown hang.
 *
 * With Redis unreachable, `@nestjs/bullmq`'s BullExplorer closes the worker
 * with a non-forced `worker.close()`, which waits forever on the reconnecting
 * blocking connection. `PhotoImportProcessor.beforeApplicationShutdown` force
 * closes first; without it this test times out.
 */
const DEAD_REDIS_PORT = '6399';
const originalRedisPort = process.env.REDIS_PORT;
const originalRedisPrefix = process.env.REDIS_QUEUE_PREFIX;

describe('Queue shutdown with Redis unreachable (e2e)', () => {
  afterAll(() => {
    if (originalRedisPort === undefined) {
      delete process.env.REDIS_PORT;
    } else {
      process.env.REDIS_PORT = originalRedisPort;
    }
    if (originalRedisPrefix === undefined) {
      delete process.env.REDIS_QUEUE_PREFIX;
    } else {
      process.env.REDIS_QUEUE_PREFIX = originalRedisPrefix;
    }
  });

  it('closes the app promptly instead of hanging on the worker', async () => {
    // Point at a port nothing listens on *before* loading AppModule: its
    // ConfigModule.forRoot captures process.env at module evaluation, so a
    // top-level import would be too early.
    process.env.REDIS_PORT = DEAD_REDIS_PORT;
    const { AppModule } = await import('../../src/app.module');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app: INestApplication = moduleRef.createNestApplication({
      logger: false,
    });
    await app.init();

    const started = Date.now();
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        app.close(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(
              new Error(
                `app.close() did not finish within 10s with Redis down (port ${DEAD_REDIS_PORT})`,
              ),
            );
          }, 10_000);
        }),
      ]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }

    expect(Date.now() - started).toBeLessThan(10_000);
  }, 30_000);
});
