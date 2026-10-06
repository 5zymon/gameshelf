import type { INestApplication } from '@nestjs/common';
import { existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Queue } from 'bullmq';
import type { Job } from 'bullmq';
import type {
  CatalogCandidate,
  CatalogResolution,
} from '../../src/game-catalog/game-catalog.resolver';
import { GameCatalogResolver } from '../../src/game-catalog/game-catalog.resolver';
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

function recognized(title: string): RecognizedItem {
  return { title, edition: null, platform: 'PlayStation 5', confidence: 0.9 };
}

function candidate(title: string): CatalogCandidate {
  return {
    externalId: 1,
    title,
    releaseYear: 2001,
    publisher: 'Sony Interactive Entertainment',
    genre: 'Action',
    coverUrl: null,
    platforms: [
      { igdbId: PLATFORM_IGDB_ID, name: 'PlayStation 5', abbreviation: 'PS5' },
    ],
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
  });
});
