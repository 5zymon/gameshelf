import type { INestApplication } from '@nestjs/common';
import { ImportJobsService } from '../../src/import-jobs/import-jobs.service';
import { PhotoImportHandler } from '../../src/queue/photo-import.handler';
import {
  PhotoImportQueue,
  runnableNowData,
} from '../../src/queue/photo-import.queue';
import type { PhotoImportJobResult } from '../../src/queue/photo-import.types';
import { QueueControlService } from '../../src/queue/queue-control.service';
import {
  PHOTO_IMPORT_CONCURRENCY,
  PHOTO_IMPORT_QUEUE,
} from '../../src/queue/queue.constants';
import {
  NO_WORKER,
  queueOptions,
  waitFor,
} from '../helpers/photo-import-queue';
import { resetDatabase } from '../helpers/reset';
import {
  createTestApp,
  type TestApp,
  type TestProviderOverride,
} from '../helpers/test-app';

/** Result a recording handler reports: nothing recognized, nothing imported. */
const OK_RESULT: PhotoImportJobResult = {
  recognizedCount: 0,
  importedCount: 0,
  unrecognizedCount: 0,
};

/** A handler that records every claim and always succeeds. */
function recordingHandler() {
  const runs: { importJobId: number; photoRef: string | null }[] = [];
  return {
    runs,
    override: {
      provide: PhotoImportHandler,
      useValue: {
        handle: jest.fn(
          (run: { importJobId: number; photoRef: string | null }) => {
            runs.push(run);
            return Promise.resolve(OK_RESULT);
          },
        ),
      },
    } satisfies TestProviderOverride,
  };
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
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
  let test: TestApp;

  beforeAll(async () => {
    test = await createTestApp([NO_WORKER]);
  });

  afterAll(async () => {
    await test.app.close();
  });

  beforeEach(async () => {
    await resetDatabase(test.prisma);
  });

  afterEach(async () => {
    while (openApps.length > 0) {
      await openApps.pop()?.close();
    }
  }, 30_000);

  it('processes a row created while no app was running (restart durability)', async () => {
    // A real stop/start cycle: app A writes the runnable row, then closes
    // before app B polls. Only the row's durability can survive this.
    const firstBoot = await createTestApp([NO_WORKER]);
    const row = await firstBoot.prisma.importJob.create({
      data: { status: 'queued', photoRef: 'restart', ...runnableNowData() },
    });
    await firstBoot.app.close();

    const recorder = recordingHandler();
    const secondBoot = await createTestApp([
      recorder.override,
      queueOptions({ pollIntervalMs: 20 }),
    ]);
    openApps.push(secondBoot.app);

    await waitFor(() => recorder.runs.length >= 1, 15_000);
    expect(recorder.runs[0]).toMatchObject({
      importJobId: row.id,
      photoRef: 'restart',
    });

    const stored = await secondBoot.prisma.importJob.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(stored.attempts).toBe(1);
    expect(stored.leaseUntil).toBeNull();
  }, 30_000);

  it('processes one row at a time (concurrency 1)', async () => {
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

    // Blocks on the first row so a second concurrent slot would be observable.
    const app = (
      await createTestApp([
        {
          provide: PhotoImportHandler,
          useValue: {
            async handle(): Promise<PhotoImportJobResult> {
              started += 1;
              active += 1;
              maxActive = Math.max(maxActive, active);
              if (started === 1) {
                signalFirstStarted();
                await gate;
              }
              active -= 1;
              return OK_RESULT;
            },
          },
        },
        queueOptions({ pollIntervalMs: 20 }),
      ])
    ).app;
    openApps.push(app);

    try {
      await test.prisma.importJob.create({
        data: { status: 'queued', photoRef: 'gate-a', ...runnableNowData() },
      });
      await test.prisma.importJob.create({
        data: { status: 'queued', photoRef: 'gate-b', ...runnableNowData() },
      });

      await firstStarted;
      await delay(300);

      expect(started).toBe(1);
      expect(active).toBe(1);
      expect(
        await test.prisma.importJob.count({ where: { status: 'processing' } }),
      ).toBe(1);
      expect(
        await test.prisma.importJob.count({ where: { status: 'queued' } }),
      ).toBe(1);

      releaseGate();
      await waitFor(() => started === 2, 15_000);
      expect(maxActive).toBe(1);
    } finally {
      // Never leave the first row blocked: `close()` waits for it.
      releaseGate();
    }
  }, 30_000);

  it('reports GET /health/queue counts from MySQL (AC6)', async () => {
    const health = await createTestApp();
    openApps.push(health.app);

    await test.prisma.importJob.create({ data: { status: 'done' } });
    await test.prisma.importJob.create({ data: { status: 'done' } });
    await test.prisma.importJob.create({
      data: { status: 'failed', errorMessage: 'boom' },
    });
    // No `nextRunAt`: the row is not runnable and must stay `queued`.
    await test.prisma.importJob.create({ data: { status: 'queued' } });

    const res = await health.request.get('/health/queue');
    expect(res.status).toBe(200);
    expect(res.body as QueueHealthBody).toEqual({
      status: 'ok',
      queue: PHOTO_IMPORT_QUEUE,
      concurrency: PHOTO_IMPORT_CONCURRENCY,
      workerReady: true,
      counts: {
        queued: 1,
        processing: 0,
        done: 2,
        needs_attention: 0,
        failed: 1,
        dismissed: 0,
      },
    });
  }, 30_000);

  it('wakes the worker on an enqueue even with a long poll interval', async () => {
    const recorder = recordingHandler();
    const app = (
      await createTestApp([
        recorder.override,
        queueOptions({ pollIntervalMs: 60_000 }),
      ])
    ).app;
    openApps.push(app);

    const importJobs = app.get(ImportJobsService);
    const row = await importJobs.createJob({ photoRef: 'wake', enqueue: true });

    // Only the enqueue wake can satisfy this: polling is a minute away.
    await waitFor(
      () => recorder.runs.some((run) => run.importJobId === row.id),
      2_000,
    );
  }, 30_000);

  it('claims nothing while paused and drains on resume (AC4)', async () => {
    const recorder = recordingHandler();
    const paused = await createTestApp([
      recorder.override,
      queueOptions({ pollIntervalMs: 50 }),
    ]);
    openApps.push(paused.app);

    await paused.app
      .get(QueueControlService)
      .pauseForConfig('igdb', 'test pause');
    const row = await test.prisma.importJob.create({
      data: { status: 'queued', photoRef: 'paused', ...runnableNowData() },
    });

    await delay(500);
    expect(recorder.runs).toHaveLength(0);
    expect(
      (await test.prisma.importJob.findUniqueOrThrow({ where: { id: row.id } }))
        .status,
    ).toBe('queued');

    await paused.login();
    const resume = await paused.request.post('/import-jobs/resume');
    expect(resume.status).toBe(200);

    await waitFor(
      () => recorder.runs.some((run) => run.importJobId === row.id),
      2_000,
    );
  }, 30_000);

  it('claims only due rows and compares due times in UTC', async () => {
    const app = (await createTestApp([NO_WORKER])).app;
    openApps.push(app);
    const queue = app.get(PhotoImportQueue);

    const never = await test.prisma.importJob.create({
      data: { status: 'queued' },
    });
    const future = await test.prisma.importJob.create({
      data: {
        status: 'queued',
        nextRunAt: new Date(Date.now() + 3_600_000),
      },
    });
    const due = await test.prisma.importJob.create({
      data: {
        status: 'queued',
        nextRunAt: new Date(Date.now() - 1_000),
      },
    });

    const claimed = await queue.claimNext(1_000);
    expect(claimed?.id).toBe(due.id);
    expect(await queue.claimNext(1_000)).toBeNull();

    expect(
      (
        await test.prisma.importJob.findUniqueOrThrow({
          where: { id: never.id },
        })
      ).status,
    ).toBe('queued');
    expect(
      (
        await test.prisma.importJob.findUniqueOrThrow({
          where: { id: future.id },
        })
      ).status,
    ).toBe('queued');
  }, 30_000);

  it('claims distinct rows under concurrent SKIP LOCKED claims', async () => {
    const app = (await createTestApp([NO_WORKER])).app;
    openApps.push(app);
    const queue = app.get(PhotoImportQueue);

    const a = await test.prisma.importJob.create({
      data: { status: 'queued', ...runnableNowData() },
    });
    const b = await test.prisma.importJob.create({
      data: { status: 'queued', ...runnableNowData() },
    });

    const [first, second] = await Promise.all([
      queue.claimNext(1_000),
      queue.claimNext(1_000),
    ]);
    const ids = [first?.id, second?.id].filter(
      (id): id is number => id !== undefined,
    );
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(ids.sort((x, y) => x - y)).toEqual(
      [a.id, b.id].sort((x, y) => x - y),
    );
  }, 30_000);
});
