import type { INestApplication } from '@nestjs/common';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  CatalogCandidate,
  CatalogResolution,
} from '../../src/game-catalog/game-catalog.resolver';
import { GameCatalogResolver } from '../../src/game-catalog/game-catalog.resolver';
import { ImportJobsService } from '../../src/import-jobs/import-jobs.service';
import { PhotoStorageService } from '../../src/import-jobs/photo-storage.service';
import {
  PermanentImportError,
  RetryableImportError,
} from '../../src/queue/photo-import.failure';
import { PhotoImportHandler } from '../../src/queue/photo-import.handler';
import {
  PhotoImportQueue,
  runnableNowData,
} from '../../src/queue/photo-import.queue';
import type { PhotoImportJobResult } from '../../src/queue/photo-import.types';
import type {
  RecognizedItem,
  VisionRecognitionResult,
} from '../../src/settings/vision/vision-provider';
import { VisionService } from '../../src/settings/vision/vision.service';
import {
  NO_WORKER,
  queueOptions,
  waitFor,
} from '../helpers/photo-import-queue';
import { resetDatabase } from '../helpers/reset';
import { createTestApp, type TestApp } from '../helpers/test-app';

const E2E_PHOTO_DIR_SUFFIX = 'gameshelf-import-photos-e2e';
const PLATFORM_IGDB_ID = 167;

/** Result a stubbed handler reports: nothing recognized, nothing imported. */
const OK_RESULT: PhotoImportJobResult = {
  recognizedCount: 0,
  importedCount: 0,
  unrecognizedCount: 0,
};

function clearPhotoDir(dir: string): void {
  if (!resolve(dir).endsWith(E2E_PHOTO_DIR_SUFFIX)) {
    throw new Error(`Refusing to delete photo directory "${dir}"`);
  }
  rmSync(dir, { recursive: true, force: true });
}

function recognized(title: string): RecognizedItem {
  return { title, edition: null, platform: 'PlayStation 5', confidence: 0.9 };
}

const EXTERNAL_IDS_BY_TITLE = new Map<string, number>();

/**
 * Deterministic, unique-per-title external id: a real catalog returns one
 * record per game, so differently-titled fixtures must not share an
 * `externalId` (the shared identity rule would otherwise link them).
 */
function externalIdFor(title: string): number {
  const existing = EXTERNAL_IDS_BY_TITLE.get(title);
  if (existing !== undefined) return existing;
  const id = EXTERNAL_IDS_BY_TITLE.size + 1;
  EXTERNAL_IDS_BY_TITLE.set(title, id);
  return id;
}

function candidate(title: string): CatalogCandidate {
  return {
    externalId: externalIdFor(title),
    title,
    releaseYear: 2001,
    publisher: 'Sony Interactive Entertainment',
    genre: 'Action',
    playerCount: null,
    coverUrl: null,
    images: [],
    platforms: [
      { igdbId: PLATFORM_IGDB_ID, name: 'PlayStation 5', abbreviation: 'PS5' },
    ],
    source: 'IGDB',
    raw: { title },
  };
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Photo import worker (e2e)', () => {
  const openApps: INestApplication[] = [];
  let test: TestApp;

  beforeAll(async () => {
    test = await createTestApp([NO_WORKER]);
  });

  afterAll(async () => {
    clearPhotoDir(test.app.get(PhotoStorageService).directory);
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

  it('backs off exponentially between retries (base 5 s shrunk to 150 ms)', async () => {
    const starts: number[] = [];
    const app = await createTestApp([
      {
        provide: PhotoImportHandler,
        useValue: {
          handle: jest.fn((): Promise<PhotoImportJobResult> => {
            starts.push(Date.now());
            if (starts.length < 3) {
              return Promise.reject(new RetryableImportError('transient'));
            }
            return Promise.resolve(OK_RESULT);
          }),
        },
      },
      queueOptions({ retryBackoffMs: 150, pollIntervalMs: 20 }),
    ]);
    openApps.push(app.app);

    const row = await test.prisma.importJob.create({
      data: { status: 'queued', photoRef: 'backoff', ...runnableNowData() },
    });

    await waitFor(() => starts.length >= 3, 15_000);

    const [first, second, third] = starts;
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error('expected three worker starts');
    }
    const gap1 = second - first;
    const gap2 = third - second;
    // Exponential: delay·2^(attemptsMade−1) → ~150 ms then ~300 ms, plus one
    // poll interval (20 ms) of scheduling slack each.
    expect(gap1).toBeGreaterThanOrEqual(130);
    expect(gap2).toBeGreaterThanOrEqual(280);
    expect(gap2).toBeGreaterThan(gap1);

    const stored = await test.prisma.importJob.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(stored.status).toBe('processing');
    expect(stored.attempts).toBe(3);
  }, 30_000);

  it('fails after exactly 3 attempts and stops retrying', async () => {
    const handler = {
      handle: jest.fn((): Promise<PhotoImportJobResult> =>
        Promise.reject(new RetryableImportError('transient')),
      ),
    };
    const app = await createTestApp([
      { provide: PhotoImportHandler, useValue: handler },
      queueOptions({ retryBackoffMs: 150, pollIntervalMs: 20 }),
    ]);
    openApps.push(app.app);

    const row = await test.prisma.importJob.create({
      data: { status: 'queued', photoRef: 'exhaust', ...runnableNowData() },
    });

    await waitFor(() => handler.handle.mock.calls.length >= 3, 15_000);
    await waitFor(
      async () =>
        (
          await test.prisma.importJob.findUniqueOrThrow({
            where: { id: row.id },
          })
        ).status === 'failed',
      15_000,
    );
    await delay(700);

    expect(handler.handle).toHaveBeenCalledTimes(3);
    const stored = await test.prisma.importJob.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(stored.status).toBe('failed');
    expect(stored.errorMessage).toBe('transient');
  }, 30_000);

  it('fails once and never retries a permanent error', async () => {
    const handler = {
      handle: jest.fn((): Promise<PhotoImportJobResult> =>
        Promise.reject(new PermanentImportError('bad', new Error('bad'))),
      ),
    };
    const app = await createTestApp([
      { provide: PhotoImportHandler, useValue: handler },
      queueOptions({ retryBackoffMs: 150, pollIntervalMs: 20 }),
    ]);
    openApps.push(app.app);

    const row = await test.prisma.importJob.create({
      data: { status: 'queued', photoRef: 'permanent', ...runnableNowData() },
    });

    await waitFor(
      async () =>
        (
          await test.prisma.importJob.findUniqueOrThrow({
            where: { id: row.id },
          })
        ).status === 'failed',
      5_000,
    );
    await delay(700);

    expect(handler.handle).toHaveBeenCalledTimes(1);
    const stored = await test.prisma.importJob.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(stored.status).toBe('failed');
    expect(stored.errorMessage).toBe('Photo recognition failed unexpectedly');
    expect(stored.leaseUntil).toBeNull();
  }, 30_000);

  it("recovers a killed worker's job with no duplicate games and no second vision call", async () => {
    const titles = Array.from(
      { length: 12 },
      (_unused, index) => `G${String(index)}`,
    );

    await test.prisma.platform.create({
      data: {
        name: 'PlayStation 5',
        slug: 'playstation-5',
        igdbId: PLATFORM_IGDB_ID,
      },
    });
    const photoRef = await test.app.get(PhotoStorageService).store({
      originalname: 'shelf.png',
      mimetype: 'image/png',
      buffer: Buffer.from('not-a-real-image'),
    } as Express.Multer.File);

    // App A: vision sees 12 titles, resolves G0..G9 and blocks forever on G10.
    const visionA = {
      recognize: jest.fn((): Promise<VisionRecognitionResult> =>
        Promise.resolve({ items: titles.map(recognized), countVisible: 12 }),
      ),
    };
    let rejectGate: (error: Error) => void = () => undefined;
    const gate = new Promise<never>((_resolve, reject) => {
      rejectGate = reject;
    });
    // Mark the gate as handled so an early failure cannot surface an unhandled
    // rejection; the resolver still receives the original promise.
    void gate.catch(() => undefined);
    const resolverA = {
      resolve: jest.fn((item: RecognizedItem): Promise<CatalogResolution> => {
        if (item.title === 'G10') return gate;
        return Promise.resolve({
          kind: 'matched',
          candidate: candidate(item.title),
        });
      }),
    };

    const appA = await createTestApp([
      { provide: VisionService, useValue: visionA },
      { provide: GameCatalogResolver, useValue: resolverA },
      queueOptions({
        leaseMs: 300,
        stallCheckIntervalMs: 50,
        shutdownGraceMs: 0,
        pollIntervalMs: 20,
      }),
    ]);
    const queueA = appA.app.get(PhotoImportQueue);

    try {
      const row = await appA.app.get(ImportJobsService).createJob({
        photoRef,
        enqueue: true,
      });

      // The first batch (10) committed; the attempt is now parked on G10.
      await waitFor(
        async () => (await appA.prisma.game.count()) === 10,
        15_000,
      );

      // "Kill" the worker: close app A while the attempt is still blocked.
      await appA.app.close();

      const killed = await test.prisma.importJob.findUniqueOrThrow({
        where: { id: row.id },
      });
      expect(killed.status).toBe('processing');
      expect(killed.attempts).toBe(1);
      expect(killed.leaseUntil).not.toBeNull();

      // App B: fresh worker/vision/resolver. It must recover the expired lease
      // and finish only the two titles that were still pending.
      const visionB = {
        recognize: jest.fn((): Promise<VisionRecognitionResult> =>
          Promise.resolve({ items: [], countVisible: null }),
        ),
      };
      const resolvedB: string[] = [];
      const resolverB = {
        resolve: jest.fn((item: RecognizedItem): Promise<CatalogResolution> => {
          resolvedB.push(item.title);
          return Promise.resolve({
            kind: 'matched',
            candidate: candidate(item.title),
          });
        }),
      };
      const appB = await createTestApp([
        { provide: VisionService, useValue: visionB },
        { provide: GameCatalogResolver, useValue: resolverB },
        queueOptions({
          leaseMs: 300,
          stallCheckIntervalMs: 50,
          // No `shutdownGraceMs: 0` here: app B is not the killed worker, and
          // `close()` must let its in-flight poll query finish before Prisma is
          // disconnected. With grace 0 the abandoned `claimNext`/`isPaused`
          // completes after `$disconnect()` and reopens the driver pool, which
          // then keeps Jest alive ("did not exit").
          pollIntervalMs: 20,
          retryBackoffMs: 150,
        }),
      ]);
      openApps.push(appB.app);

      await waitFor(
        async () =>
          (
            await appB.prisma.importJob.findUniqueOrThrow({
              where: { id: row.id },
            })
          ).status === 'done',
        20_000,
      );

      expect(await appB.prisma.game.count()).toBe(12);
      for (const title of titles) {
        expect(await appB.prisma.game.count({ where: { title } })).toBe(1);
      }
      // `visionCompletedAt` was already set, so the recovered attempt reuses it.
      expect(visionB.recognize).not.toHaveBeenCalled();
      expect(resolverB.resolve).toHaveBeenCalledTimes(2);
      expect([...resolvedB].sort()).toEqual(['G10', 'G11']);

      const recovered = await appB.prisma.importJob.findUniqueOrThrow({
        where: { id: row.id },
      });
      expect(recovered.attempts).toBe(2);
    } finally {
      // Unwind app A's abandoned attempt. Rejecting the gate makes the attempt
      // finish its post-failure bookkeeping, which reconnects the Prisma client
      // `app.close()` disconnected. Wait for its last DB call
      // (`PhotoImportQueue.release`) and then close that connection so the
      // process can exit.
      let releaseDone: () => void = () => undefined;
      const released = new Promise<void>((resolve) => {
        releaseDone = resolve;
      });
      const originalRelease = queueA.release.bind(queueA);
      jest
        .spyOn(queueA, 'release')
        .mockImplementation(async (id: number): Promise<void> => {
          await originalRelease(id);
          releaseDone();
        });

      rejectGate(new Error('worker killed mid-job'));
      await released;
      await appA.prisma.$disconnect();
    }
  }, 40_000);
});
