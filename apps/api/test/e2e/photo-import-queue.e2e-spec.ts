import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import { AppModule } from '../../src/app.module';
import { PhotoImportHandler } from '../../src/queue/photo-import.handler';
import {
  PHOTO_IMPORT_CONCURRENCY,
  PHOTO_IMPORT_QUEUE,
} from '../../src/queue/queue.constants';
import type { PhotoImportJobResult } from '../../src/queue/photo-import.types';
import { createNoopPhotoImportHandler } from '../helpers/noop-photo-handler';
import { createTestApp } from '../helpers/test-app';

/**
 * Overrides the real handler so the queue tests observe scheduling only and
 * never run recognition, external lookups, or catalog writes.
 */
const NOOP_OVERRIDE = [
  {
    provide: PhotoImportHandler,
    useValue: createNoopPhotoImportHandler(),
  },
];

/**
 * The connection and key prefix used by the test's own producer queues. The
 * worker under test uses the application's connection (REDIS_HOST/REDIS_PORT)
 * and prefix (REDIS_QUEUE_PREFIX); both point at the same local Redis but the
 * `bull-e2e` prefix in test/setup-env.ts keeps this suite in its own keyspace,
 * so it neither steals jobs from nor obliterates a developer's dev queue.
 */
const connection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 6379),
};
const queuePrefix = process.env.REDIS_QUEUE_PREFIX ?? 'bull-e2e';

function rawQueue(): Queue {
  return new Queue(PHOTO_IMPORT_QUEUE, { connection, prefix: queuePrefix });
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await delay(50);
  }
  throw new Error(`condition not met within ${String(timeoutMs)}ms`);
}

interface QueueHealthBody {
  status: string;
  queue: string;
  concurrency: number;
  workerReady: boolean;
  counts: Record<string, number>;
}

describe('Photo import queue (e2e)', () => {
  const openApps: INestApplication[] = [];

  beforeEach(async () => {
    const queue = rawQueue();
    await queue.obliterate({ force: true });
    await queue.close();
  }, 30_000);

  afterEach(async () => {
    while (openApps.length > 0) {
      const app = openApps.pop();
      if (app) {
        await app.close();
      }
    }
  }, 30_000);

  it('survives an app stop/start: a job enqueued while the API is down is processed after it starts again', async () => {
    // 1. Boot the full app (worker runs), then stop it again — a real
    //    stop/start cycle, not just a cold start.
    const firstBoot = await createTestApp(NOOP_OVERRIDE);
    await firstBoot.app.close();

    // 2. With no app running, enqueue the job. It exists only in Redis now.
    const queue = rawQueue();
    try {
      const job = await queue.add('photo', { photoRef: 'restart' });
      expect(await job.getState()).toBe('waiting');

      // 3. A freshly started app must pick up the persisted job.
      const secondBoot = await createTestApp(NOOP_OVERRIDE);
      openApps.push(secondBoot.app);

      await waitFor(async () => (await job.getState()) === 'completed', 15_000);
      expect(await job.getState()).toBe('completed');
    } finally {
      await queue.close();
    }
    // Scope: this proves job state survives an application shutdown/start in
    // Redis and is drained by the restarted worker. It does NOT kill a worker
    // mid-job; the process-level restart of the compiled API was verified
    // manually (see README, "Worker restart and shutdown").
  }, 30_000);

  it('processes jobs with concurrency exactly 1', async () => {
    let started = 0;
    let active = 0;
    let maxActive = 0;
    let releaseGate: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    let signalFirstStarted: () => void = () => undefined;
    const firstStarted = new Promise<void>((resolve) => {
      signalFirstStarted = resolve;
    });

    // A handler that blocks on the first job so a second concurrent slot, if it
    // existed, would be observable.
    const blockingHandler = {
      async handle(): Promise<PhotoImportJobResult> {
        started += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        if (started === 1) {
          signalFirstStarted();
          await gate;
        }
        active -= 1;
        return { recognizedCount: 0, importedCount: 0, unrecognizedCount: 0 };
      },
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PhotoImportHandler)
      .useValue(blockingHandler)
      .compile();
    const app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    openApps.push(app);

    const queue = rawQueue();
    try {
      await queue.add('photo', { photoRef: 'gate-a' });
      await queue.add('photo', { photoRef: 'gate-b' });

      await firstStarted;
      await delay(300);

      // With concurrency 1 the second job must still be waiting; with 2 it
      // would already have started (started === 2, active === 2).
      expect(started).toBe(1);
      expect(active).toBe(1);
      const counts = await queue.getJobCounts('active', 'waiting');
      expect(counts.active).toBe(1);
      expect(counts.waiting).toBe(1);

      releaseGate();
      await waitFor(
        async () => (await queue.getJobCounts('completed')).completed === 2,
        15_000,
      );
      expect(started).toBe(2);
      expect(maxActive).toBe(1);
    } finally {
      // Never leave the first job blocked: `app.close()` waits for it.
      releaseGate();
      await queue.close();
    }
  }, 30_000);

  it('exposes GET /health/queue with the pinned concurrency and a ready worker', async () => {
    const test = await createTestApp();
    openApps.push(test.app);

    await waitFor(async () => {
      const res = await test.request.get('/health/queue');
      return res.status === 200 && (res.body as QueueHealthBody).workerReady;
    }, 15_000);

    const res = await test.request.get('/health/queue');
    expect(res.status).toBe(200);
    const body = res.body as QueueHealthBody;
    expect(body).toMatchObject({
      status: 'ok',
      queue: PHOTO_IMPORT_QUEUE,
      concurrency: PHOTO_IMPORT_CONCURRENCY,
      workerReady: true,
    });
    expect(typeof body.counts.waiting).toBe('number');
    expect(typeof body.counts.completed).toBe('number');
    expect(typeof body.counts.prioritized).toBe('number');
    expect(typeof body.counts['waiting-children']).toBe('number');
  });
});
