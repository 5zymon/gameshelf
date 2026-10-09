import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication } from '@nestjs/common';
import { existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Queue, UnrecoverableError } from 'bullmq';
import type { Job } from 'bullmq';
import type {
  CatalogCandidate,
  CatalogResolution,
} from '../../src/game-catalog/game-catalog.resolver';
import { GameCatalogResolver } from '../../src/game-catalog/game-catalog.resolver';
import {
  ImportJobsService,
  type ImportBatchOutcome,
} from '../../src/import-jobs/import-jobs.service';
import { PhotoStorageService } from '../../src/import-jobs/photo-storage.service';
import { PhotoImportHandler } from '../../src/queue/photo-import.handler';
import { RetryableImportError } from '../../src/queue/photo-import.failure';
import type { PhotoImportJobData } from '../../src/queue/photo-import.types';
import { PHOTO_IMPORT_QUEUE } from '../../src/queue/queue.constants';
import type {
  RecognizedItem,
  VisionRecognitionResult,
} from '../../src/settings/vision/vision-provider';
import { VisionService } from '../../src/settings/vision/vision.service';
import { resetDatabase } from '../helpers/reset';
import { createTestApp, type TestApp } from '../helpers/test-app';

const connection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 6379),
};
const queuePrefix = process.env.REDIS_QUEUE_PREFIX ?? 'bull-e2e';
const E2E_PHOTO_DIR_SUFFIX = 'gameshelf-import-photos-e2e';
const PLATFORM_IGDB_ID = 167;

function clearPhotoDir(dir: string): void {
  if (!resolve(dir).endsWith(E2E_PHOTO_DIR_SUFFIX)) {
    throw new Error(`Refusing to delete photo directory "${dir}"`);
  }
  rmSync(dir, { recursive: true, force: true });
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((done) => setTimeout(done, 50));
  }
  throw new Error(`condition not met within ${String(timeoutMs)}ms`);
}

function recognized(title: string): RecognizedItem {
  return { title, edition: null, platform: 'PlayStation 5', confidence: 0.9 };
}

function recognizedWithPlatform(
  title: string,
  platform: string,
): RecognizedItem {
  return { title, edition: null, platform, confidence: 0.9 };
}

const EXTERNAL_IDS_BY_TITLE = new Map<string, number>();

/**
 * Deterministic, unique-per-title external id. A real catalog returns one
 * record per game, so two differently-titled fixtures must not share an
 * `externalId` (the shared identity rule would otherwise link them into one
 * row).
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

function makeJob(
  importJobId: number,
  photoRef: string,
  attemptsMade = 0,
  attempts = 3,
): Job<PhotoImportJobData> {
  return {
    id: `e2e-${String(importJobId)}`,
    attemptsMade,
    opts: { attempts },
    data: { photoRef, importJobId },
  } as unknown as Job<PhotoImportJobData>;
}

describe('Photo import pipeline (e2e)', () => {
  let test: TestApp;
  let app: INestApplication;
  let queue: Queue;
  let photoDir: string;
  let vision: { recognize: jest.Mock };
  let resolver: { resolve: jest.Mock };

  beforeAll(async () => {
    vision = {
      recognize: jest.fn((): Promise<VisionRecognitionResult> =>
        Promise.resolve({ items: [], countVisible: null }),
      ),
    };
    resolver = {
      resolve: jest.fn((): Promise<CatalogResolution> =>
        Promise.resolve({ kind: 'unrecognized', reason: 'none' }),
      ),
    };
    test = await createTestApp([
      { provide: VisionService, useValue: vision },
      { provide: GameCatalogResolver, useValue: resolver },
    ]);
    app = test.app;
    photoDir = app.get(PhotoStorageService).directory;
    queue = new Queue(PHOTO_IMPORT_QUEUE, { connection, prefix: queuePrefix });
  });

  beforeEach(async () => {
    await resetDatabase(test.prisma);
    await queue.obliterate({ force: true });
    // A paused queue must never leak between tests (ticket 3.10).
    await queue.resume();
    clearPhotoDir(photoDir);
    vision.recognize.mockReset();
    vision.recognize.mockResolvedValue({ items: [], countVisible: null });
    resolver.resolve.mockReset();
  });

  afterAll(async () => {
    await queue.close();
    await app.close();
    clearPhotoDir(photoDir);
  });

  /** Seeds a Platform, writes a photo, and creates a queued import job. */
  async function seedJob(declaredCount: number | null = null): Promise<{
    id: number;
    photoRef: string;
  }> {
    await test.prisma.platform.create({
      data: {
        name: 'PlayStation 5',
        slug: 'playstation-5',
        igdbId: PLATFORM_IGDB_ID,
      },
    });
    const photoRef = await app.get(PhotoStorageService).store({
      originalname: 'shelf.png',
      mimetype: 'image/png',
      buffer: Buffer.from('not-a-real-image'),
    } as Express.Multer.File);
    const row = await test.prisma.importJob.create({
      data: { status: 'queued', declaredCount, photoRef },
    });
    return { id: row.id, photoRef };
  }

  it('produces N externally validated games and deletes the photo after completion', async () => {
    const { id, photoRef } = await seedJob();
    const titles = Array.from(
      { length: 12 },
      (_unused, index) => `Game ${String(index)}`,
    );
    vision.recognize.mockResolvedValue({
      items: titles.map(recognized),
      countVisible: 12,
    });
    resolver.resolve.mockImplementation((item: RecognizedItem) =>
      Promise.resolve({ kind: 'matched', candidate: candidate(item.title) }),
    );

    const result = await app
      .get(PhotoImportHandler)
      .handle(makeJob(id, photoRef));

    expect(result).toEqual({
      recognizedCount: 12,
      importedCount: 12,
      unrecognizedCount: 0,
    });
    expect(await test.prisma.game.count()).toBe(12);
    expect(
      await test.prisma.recognizedItem.count({ where: { status: 'imported' } }),
    ).toBe(12);
    const job = await test.prisma.importJob.findUniqueOrThrow({
      where: { id },
    });
    expect(job.status).toBe('done');
    expect(job.recognizedCount).toBe(12);
    expect(job.importedCount).toBe(12);
    expect(job.unrecognizedCount).toBe(0);
    expect(existsSync(join(photoDir, photoRef))).toBe(false);
  });

  it('never duplicates games when the same job is handled twice', async () => {
    const { id, photoRef } = await seedJob();
    vision.recognize.mockResolvedValue({
      items: [recognized('A'), recognized('B'), recognized('C')],
      countVisible: 3,
    });
    resolver.resolve.mockImplementation((item: RecognizedItem) =>
      Promise.resolve({ kind: 'matched', candidate: candidate(item.title) }),
    );
    const handler = app.get(PhotoImportHandler);

    await handler.handle(makeJob(id, photoRef));
    const second = await handler.handle(makeJob(id, photoRef));

    expect(await test.prisma.game.count()).toBe(3);
    expect(second).toEqual({
      recognizedCount: 3,
      importedCount: 3,
      unrecognizedCount: 0,
    });
    expect(vision.recognize).toHaveBeenCalledTimes(1);
  });

  it('records unrecognized titles without adding catalog rows', async () => {
    const { id, photoRef } = await seedJob();
    vision.recognize.mockResolvedValue({
      items: [recognized('Mystery One'), recognized('Mystery Two')],
      countVisible: 2,
    });
    resolver.resolve.mockResolvedValue({
      kind: 'unrecognized',
      reason: 'No IGDB game matched the title',
    });

    const result = await app
      .get(PhotoImportHandler)
      .handle(makeJob(id, photoRef));

    expect(await test.prisma.game.count()).toBe(0);
    expect(await test.prisma.unrecognizedItem.count()).toBe(2);
    expect(
      await test.prisma.recognizedItem.count({
        where: { status: 'unrecognized' },
      }),
    ).toBe(2);
    expect(result).toEqual({
      recognizedCount: 2,
      importedCount: 0,
      unrecognizedCount: 2,
    });
    const job = await test.prisma.importJob.findUniqueOrThrow({
      where: { id },
    });
    expect(job.status).toBe('needs_attention');
    expect(existsSync(join(photoDir, photoRef))).toBe(false);
  });

  it('persists committed batches when a later batch fails, and keeps the photo', async () => {
    const { id, photoRef } = await seedJob();
    const titles = Array.from(
      { length: 12 },
      (_unused, index) => `G${String(index)}`,
    );
    vision.recognize.mockResolvedValue({
      items: titles.map(recognized),
      countVisible: 12,
    });
    resolver.resolve.mockImplementation((item: RecognizedItem) => {
      if (item.title === 'G10' || item.title === 'G11') {
        return Promise.reject(new Error('worker killed mid-job'));
      }
      return Promise.resolve({
        kind: 'matched',
        candidate: candidate(item.title),
      });
    });

    await expect(
      app.get(PhotoImportHandler).handle(makeJob(id, photoRef, 2, 3)),
    ).rejects.toThrow('worker killed mid-job');

    // The first batch (10) committed before the failure; the second did not.
    expect(await test.prisma.game.count()).toBe(10);
    expect(
      await test.prisma.recognizedItem.count({ where: { status: 'imported' } }),
    ).toBe(10);
    expect(
      await test.prisma.recognizedItem.count({ where: { status: 'pending' } }),
    ).toBe(2);
    const job = await test.prisma.importJob.findUniqueOrThrow({
      where: { id },
    });
    expect(job.status).toBe('failed');
    // The committed batch's counters survive the permanent failure.
    expect(job.recognizedCount).toBe(12);
    expect(job.importedCount).toBe(10);
    expect(job.unrecognizedCount).toBe(0);
    expect(existsSync(join(photoDir, photoRef))).toBe(true);
  });

  it('retries only the unresolved titles after a transient lookup failure', async () => {
    const { id, photoRef } = await seedJob();
    vision.recognize.mockResolvedValue({
      items: [recognized('A'), recognized('B'), recognized('C')],
      countVisible: 3,
    });
    let bAttempt = 0;
    resolver.resolve.mockImplementation((item: RecognizedItem) => {
      if (item.title === 'B' && bAttempt === 0) {
        return Promise.resolve({ kind: 'transient', reason: '429' });
      }
      return Promise.resolve({
        kind: 'matched',
        candidate: candidate(item.title),
      });
    });

    await expect(
      app.get(PhotoImportHandler).handle(makeJob(id, photoRef, 0, 3)),
    ).rejects.toThrow(RetryableImportError);

    const midway = await test.prisma.importJob.findUniqueOrThrow({
      where: { id },
    });
    expect(midway.status).toBe('processing');
    expect(await test.prisma.game.count()).toBe(2);
    expect(
      await test.prisma.recognizedItem.count({ where: { status: 'pending' } }),
    ).toBe(1);
    expect(existsSync(join(photoDir, photoRef))).toBe(true);

    bAttempt = 1;
    const result = await app
      .get(PhotoImportHandler)
      .handle(makeJob(id, photoRef, 1, 3));

    expect(vision.recognize).toHaveBeenCalledTimes(1);
    expect(await test.prisma.game.count()).toBe(3);
    expect(result.importedCount).toBe(3);
    expect(existsSync(join(photoDir, photoRef))).toBe(false);
  });

  it('validates every saved game against the external catalog', async () => {
    const { id, photoRef } = await seedJob();
    vision.recognize.mockResolvedValue({
      items: [recognized('Validated Title')],
      countVisible: 1,
    });
    resolver.resolve.mockResolvedValue({
      kind: 'matched',
      candidate: candidate('Validated Title'),
    });

    await app.get(PhotoImportHandler).handle(makeJob(id, photoRef));

    expect(resolver.resolve).toHaveBeenCalledTimes(1);
    const game = await test.prisma.game.findFirstOrThrow();
    expect(game.title).toBe('Validated Title');
    expect(game.source).toBe('IGDB');
    expect(game.enrichedAt).not.toBeNull();
    expect(game.playerCount).toBeNull();
    // The raw upstream payload is archived in the archival column.
    expect(JSON.parse(game.rawMetadata ?? '')).toEqual({
      title: 'Validated Title',
    });
  });

  it('fails the current photo and pauses the queue on an IGDB config error', async () => {
    const { id, photoRef } = await seedJob();
    vision.recognize.mockResolvedValue({
      items: [recognized('A')],
      countVisible: 1,
    });
    resolver.resolve.mockResolvedValue({
      kind: 'config_error',
      source: 'igdb',
      reason: 'IGDB rejected the credentials',
    });

    await expect(
      app.get(PhotoImportHandler).handle(makeJob(id, photoRef, 0, 3)),
    ).rejects.toThrow(UnrecoverableError);

    const job = await test.prisma.importJob.findUniqueOrThrow({
      where: { id },
    });
    expect(job.status).toBe('failed');
    expect(job.errorMessage).toBe('IGDB rejected the credentials');
    expect(await queue.isPaused()).toBe(true);
    const state = await test.prisma.importQueueState.findUnique({
      where: { id: 1 },
    });
    expect(state).toMatchObject({ paused: true, source: 'igdb' });
    // The photo is kept for a retry after the configuration is fixed.
    expect(existsSync(join(photoDir, photoRef))).toBe(true);
    // Nothing from the batch was committed.
    expect(await test.prisma.game.count()).toBe(0);
  });

  describe('ticket 3.9 retry-semantics (ADR-002 gaps)', () => {
    it('processes an enqueued photo through the real BullMQ worker with stubbed vision and catalog', async () => {
      const { id, photoRef } = await seedJob();
      vision.recognize.mockResolvedValue({
        items: [recognized('A'), recognized('B')],
        countVisible: 2,
      });
      resolver.resolve.mockImplementation((item: RecognizedItem) =>
        Promise.resolve({ kind: 'matched', candidate: candidate(item.title) }),
      );

      const appQueue = test.app.get<Queue<PhotoImportJobData>>(
        getQueueToken(PHOTO_IMPORT_QUEUE),
      );
      const job = await appQueue.add('photo', { photoRef, importJobId: id });
      await waitFor(async () => (await job.getState()) === 'completed', 15_000);
      const finished = await appQueue.getJob(String(job.id));

      expect(await test.prisma.game.count()).toBe(2);
      expect(
        await test.prisma.recognizedItem.count({
          where: { status: 'imported' },
        }),
      ).toBe(2);
      const row = await test.prisma.importJob.findUniqueOrThrow({
        where: { id },
      });
      expect(row.status).toBe('done');
      expect(row.recognizedCount).toBe(2);
      expect(row.importedCount).toBe(2);
      expect(row.unrecognizedCount).toBe(0);
      expect(existsSync(join(photoDir, photoRef))).toBe(false);
      expect(vision.recognize).toHaveBeenCalledTimes(1);
      expect(resolver.resolve).toHaveBeenCalledTimes(2);
      expect(finished?.returnvalue).toEqual({
        recognizedCount: 2,
        importedCount: 2,
        unrecognizedCount: 0,
      });
    }, 20_000);

    it('commits the first batch of 10 when a later title fails, out of 20 recognized', async () => {
      const { id, photoRef } = await seedJob();
      const titles = Array.from(
        { length: 20 },
        (_unused, index) => `G${String(index)}`,
      );
      vision.recognize.mockResolvedValue({
        items: titles.map(recognized),
        countVisible: 20,
      });
      resolver.resolve.mockImplementation((item: RecognizedItem) => {
        const n = Number(item.title.slice(1));
        if (n === 12) {
          return Promise.reject(new Error('worker killed mid-job'));
        }
        return Promise.resolve({
          kind: 'matched',
          candidate: candidate(item.title),
        });
      });

      await expect(
        app.get(PhotoImportHandler).handle(makeJob(id, photoRef, 2, 3)),
      ).rejects.toThrow('worker killed mid-job');

      // The first batch (10) committed; the second never reached its commit, so
      // its in-flight G10/G11 resolutions were rolled back with the batch.
      expect(await test.prisma.game.count()).toBe(10);
      expect(
        await test.prisma.recognizedItem.count({
          where: { status: 'imported' },
        }),
      ).toBe(10);
      expect(
        await test.prisma.recognizedItem.count({
          where: { status: 'pending' },
        }),
      ).toBe(10);
      const job = await test.prisma.importJob.findUniqueOrThrow({
        where: { id },
      });
      expect(job.status).toBe('failed');
      expect(job.recognizedCount).toBe(20);
      expect(job.importedCount).toBe(10);
      expect(job.unrecognizedCount).toBe(0);
      expect(resolver.resolve).toHaveBeenCalledTimes(13);
      expect(existsSync(join(photoDir, photoRef))).toBe(true);
    });

    it('never creates a duplicate game when the same batch is committed twice (pending claim)', async () => {
      const { id } = await seedJob();
      const platform = await test.prisma.platform.findFirstOrThrow({
        where: { igdbId: PLATFORM_IGDB_ID },
      });
      const item = await test.prisma.recognizedItem.create({
        data: {
          importJobId: id,
          position: 0,
          rawTitle: 'A',
          confidence: 0.9,
          status: 'pending',
        },
      });
      const importJobs = app.get(ImportJobsService);
      const outcome: ImportBatchOutcome = {
        resolved: [
          {
            recognizedItemId: item.id,
            platformId: platform.id,
            edition: null,
            candidate: candidate('A'),
          },
        ],
        unrecognized: [],
        transient: [],
      };

      await importJobs.commitImportBatch(id, outcome);
      await expect(importJobs.commitImportBatch(id, outcome)).rejects.toThrow(
        RetryableImportError,
      );

      expect(await test.prisma.game.count()).toBe(1);
      expect(
        await test.prisma.recognizedItem.count({
          where: { status: 'imported' },
        }),
      ).toBe(1);
    });

    it('links two recognized items resolving to the same candidate into one row without incrementing copies', async () => {
      const { id } = await seedJob();
      const platform = await test.prisma.platform.findFirstOrThrow({
        where: { igdbId: PLATFORM_IGDB_ID },
      });
      const first = await test.prisma.recognizedItem.create({
        data: {
          importJobId: id,
          position: 0,
          rawTitle: 'A',
          confidence: 0.9,
          status: 'pending',
        },
      });
      const second = await test.prisma.recognizedItem.create({
        data: {
          importJobId: id,
          position: 1,
          rawTitle: 'B',
          confidence: 0.9,
          status: 'pending',
        },
      });
      const importJobs = app.get(ImportJobsService);
      // Both candidates carry the same external record (same source +
      // externalId); the shared identity rule links them to one row despite
      // the different upstream titles.
      const sharedExternalId = candidate('A').externalId;
      const outcome: ImportBatchOutcome = {
        resolved: [
          {
            recognizedItemId: first.id,
            platformId: platform.id,
            edition: null,
            candidate: candidate('A'),
          },
          {
            recognizedItemId: second.id,
            platformId: platform.id,
            edition: null,
            candidate: { ...candidate('B'), externalId: sharedExternalId },
          },
        ],
        unrecognized: [],
        transient: [],
      };

      await importJobs.commitImportBatch(id, outcome);

      expect(await test.prisma.game.count()).toBe(1);
      const game = await test.prisma.game.findFirstOrThrow();
      // Importing the same physical copy again links, never increments.
      expect(game.copyCount).toBe(1);
      const items = await test.prisma.recognizedItem.findMany({
        orderBy: { position: 'asc' },
      });
      expect(items.map((item) => item.status)).toEqual([
        'imported',
        'imported',
      ]);
      expect(items.map((item) => item.gameId)).toEqual([game.id, game.id]);
    });

    it('ends needs_attention with declaredCountMismatch when the model finds fewer than declared', async () => {
      const { id, photoRef } = await seedJob(20);
      const titles = Array.from(
        { length: 12 },
        (_unused, index) => `G${String(index)}`,
      );
      vision.recognize.mockResolvedValue({
        items: titles.map(recognized),
        countVisible: 12,
      });
      resolver.resolve.mockImplementation((item: RecognizedItem) =>
        Promise.resolve({ kind: 'matched', candidate: candidate(item.title) }),
      );

      const result = await app
        .get(PhotoImportHandler)
        .handle(makeJob(id, photoRef));

      expect(result).toEqual({
        recognizedCount: 12,
        importedCount: 12,
        unrecognizedCount: 0,
      });
      const job = await test.prisma.importJob.findUniqueOrThrow({
        where: { id },
      });
      expect(job.status).toBe('needs_attention');
      expect(job.declaredCount).toBe(20);
      expect(job.recognizedCount).toBe(12);

      await test.login();
      const res = await test.request.get(`/import-jobs/${String(id)}`);
      expect(res.status).toBe(200);
      const body = res.body as {
        declaredCountMismatch: boolean;
        needsAttention: boolean;
      };
      expect(body.declaredCountMismatch).toBe(true);
      expect(body.needsAttention).toBe(true);
      expect(existsSync(join(photoDir, photoRef))).toBe(false);
    });
  });

  describe('ticket 4.11 import-created platforms', () => {
    it('creates exactly one flagged platform for two items with the same unknown name', async () => {
      const { id, photoRef } = await seedJob();
      vision.recognize.mockResolvedValue({
        items: [
          recognizedWithPlatform('A', 'PlayStaton 5'),
          recognizedWithPlatform('B', 'PlayStaton 5'),
        ],
        countVisible: 2,
      });
      // The candidate carries no platform, so the raw box name is the only
      // signal — the platform disagreement path (spec §4.2.2).
      resolver.resolve.mockImplementation((item: RecognizedItem) =>
        Promise.resolve({
          kind: 'matched',
          candidate: { ...candidate(item.title), platforms: [] },
        }),
      );

      const result = await app
        .get(PhotoImportHandler)
        .handle(makeJob(id, photoRef));

      expect(result).toEqual({
        recognizedCount: 2,
        importedCount: 2,
        unrecognizedCount: 0,
      });
      expect(await test.prisma.game.count()).toBe(2);
      await expect(
        test.prisma.platform.count({ where: { name: 'PlayStaton 5' } }),
      ).resolves.toBe(1);
      const created = await test.prisma.platform.findFirstOrThrow({
        where: { name: 'PlayStaton 5' },
      });
      expect(created.addedByImport).toBe(true);
    });
  });

  describe('ticket 4.8 declared vs recognized count', () => {
    it('ends done with no flags when items are recognized and nothing was declared', async () => {
      const { id, photoRef } = await seedJob();
      vision.recognize.mockResolvedValue({
        items: [recognized('A'), recognized('B'), recognized('C')],
        countVisible: 3,
      });
      resolver.resolve.mockImplementation((item: RecognizedItem) =>
        Promise.resolve({ kind: 'matched', candidate: candidate(item.title) }),
      );

      const result = await app
        .get(PhotoImportHandler)
        .handle(makeJob(id, photoRef));

      expect(result).toEqual({
        recognizedCount: 3,
        importedCount: 3,
        unrecognizedCount: 0,
      });
      const job = await test.prisma.importJob.findUniqueOrThrow({
        where: { id },
      });
      expect(job.status).toBe('done');
      expect(job.declaredCount).toBeNull();

      await test.login();
      const res = await test.request.get(`/import-jobs/${String(id)}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'done',
        declaredCount: null,
        recognizedCount: 3,
        needsAttention: false,
        declaredCountMismatch: false,
      });
      expect(existsSync(join(photoDir, photoRef))).toBe(false);
    });

    it('ignores the model advisory count when computing the flag', async () => {
      const { id, photoRef } = await seedJob(2);
      vision.recognize.mockResolvedValue({
        items: [recognized('A'), recognized('B')],
        countVisible: 0,
      });
      resolver.resolve.mockImplementation((item: RecognizedItem) =>
        Promise.resolve({ kind: 'matched', candidate: candidate(item.title) }),
      );

      const result = await app
        .get(PhotoImportHandler)
        .handle(makeJob(id, photoRef));

      expect(result).toEqual({
        recognizedCount: 2,
        importedCount: 2,
        unrecognizedCount: 0,
      });
      const job = await test.prisma.importJob.findUniqueOrThrow({
        where: { id },
      });
      expect(job.status).toBe('done');
      expect(job.declaredCount).toBe(2);
      expect(job.recognizedCount).toBe(2);

      await test.login();
      const res = await test.request.get(`/import-jobs/${String(id)}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'done',
        declaredCount: 2,
        recognizedCount: 2,
        needsAttention: false,
        declaredCountMismatch: false,
      });
    });
  });
});
