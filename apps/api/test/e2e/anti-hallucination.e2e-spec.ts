import type { INestApplication } from '@nestjs/common';
import { existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Job } from 'bullmq';
import { ChainedGameCatalogResolver } from '../../src/game-catalog/chained-game-catalog.resolver';
import type {
  CatalogResolution,
  GameCatalogSource,
} from '../../src/game-catalog/game-catalog.resolver';
import { GameCatalogResolver } from '../../src/game-catalog/game-catalog.resolver';
import { PhotoStorageService } from '../../src/import-jobs/photo-storage.service';
import { PhotoImportHandler } from '../../src/queue/photo-import.handler';
import { RetryableImportError } from '../../src/queue/photo-import.failure';
import type { PhotoImportJobData } from '../../src/queue/photo-import.types';
import type {
  RecognizedItem,
  VisionRecognitionResult,
} from '../../src/settings/vision/vision-provider';
import { VisionService } from '../../src/settings/vision/vision.service';
import { resetDatabase } from '../helpers/reset';
import { createTestApp, type TestApp } from '../helpers/test-app';

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

type ResolveMock = jest.Mock<Promise<CatalogResolution>, [RecognizedItem]>;

/** The call order of a mock's first invocation, asserting it was called. */
function firstCallOrder(mock: ResolveMock): number {
  const order = mock.mock.invocationCallOrder[0];
  if (order === undefined) {
    throw new Error('expected the source to have been called');
  }
  return order;
}

describe('Anti-hallucination validation (e2e)', () => {
  let test: TestApp;
  let app: INestApplication;
  let photoDir: string;
  let vision: { recognize: jest.Mock };
  let igdb: GameCatalogSource;
  let igdbResolve: ResolveMock;
  let fallback: GameCatalogSource;
  let fallbackResolve: ResolveMock;

  beforeAll(async () => {
    igdbResolve = jest.fn<Promise<CatalogResolution>, [RecognizedItem]>();
    fallbackResolve = jest.fn<Promise<CatalogResolution>, [RecognizedItem]>();
    igdb = { label: 'IGDB', resolve: igdbResolve, search: jest.fn() };
    fallback = {
      label: 'MobyGames',
      resolve: fallbackResolve,
      search: jest.fn(),
    };
    vision = {
      recognize: jest.fn((): Promise<VisionRecognitionResult> =>
        Promise.resolve({ items: [], countVisible: null }),
      ),
    };
    test = await createTestApp([
      { provide: VisionService, useValue: vision },
      {
        provide: GameCatalogResolver,
        useValue: new ChainedGameCatalogResolver([igdb, fallback]),
      },
    ]);
    app = test.app;
    photoDir = app.get(PhotoStorageService).directory;
  });

  beforeEach(async () => {
    await resetDatabase(test.prisma);
    clearPhotoDir(photoDir);
    vision.recognize.mockReset();
    vision.recognize.mockResolvedValue({ items: [], countVisible: null });
    igdbResolve.mockReset();
    fallbackResolve.mockReset();
  });

  afterAll(async () => {
    await app.close();
    clearPhotoDir(photoDir);
  });

  /** Seeds a Platform, writes a photo, and creates a queued import job. */
  async function seedJob(): Promise<{ id: number; photoRef: string }> {
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
      data: { status: 'queued', declaredCount: null, photoRef },
    });
    return { id: row.id, photoRef };
  }

  it('never saves an invented title and traces it as unrecognized', async () => {
    const { id, photoRef } = await seedJob();
    vision.recognize.mockResolvedValue({
      items: [recognized('Zorblax Chronicles 9000')],
      countVisible: 1,
    });
    igdbResolve.mockResolvedValue({
      kind: 'unrecognized',
      reason: 'No IGDB game matched the title',
    });
    fallbackResolve.mockResolvedValue({
      kind: 'unrecognized',
      reason: 'No MobyGames game matched the title',
    });

    const result = await app
      .get(PhotoImportHandler)
      .handle(makeJob(id, photoRef));

    expect(result).toEqual({
      recognizedCount: 1,
      importedCount: 0,
      unrecognizedCount: 1,
    });
    expect(await test.prisma.game.count()).toBe(0);
    expect(
      await test.prisma.recognizedItem.count({ where: { status: 'pending' } }),
    ).toBe(0);

    const flagged = await test.prisma.unrecognizedItem.findMany();
    expect(flagged).toHaveLength(1);
    expect(flagged[0]?.rawTitle).toBe('Zorblax Chronicles 9000');
    expect(flagged[0]?.reason).toBe(
      'No game matched the title in any source — IGDB: No IGDB game matched the title; MobyGames: No MobyGames game matched the title',
    );

    expect(igdbResolve).toHaveBeenCalledTimes(1);
    expect(fallbackResolve).toHaveBeenCalledTimes(1);
    expect(firstCallOrder(igdbResolve)).toBeLessThan(
      firstCallOrder(fallbackResolve),
    );

    const job = await test.prisma.importJob.findUniqueOrThrow({
      where: { id },
    });
    expect(job.status).toBe('needs_attention');
    expect(existsSync(join(photoDir, photoRef))).toBe(false);
  });

  it('records MobyGames provenance when the fallback resolves a title IGDB missed', async () => {
    const { id, photoRef } = await seedJob();
    vision.recognize.mockResolvedValue({
      items: [recognized('Obscure Gem')],
      countVisible: 1,
    });
    igdbResolve.mockResolvedValue({
      kind: 'unrecognized',
      reason: 'No IGDB game matched the title',
    });
    fallbackResolve.mockResolvedValue({
      kind: 'matched',
      candidate: {
        externalId: 777,
        title: 'Obscure Gem',
        releaseYear: 1999,
        publisher: 'Indie Co',
        genre: 'Puzzle',
        playerCount: null,
        coverUrl: null,
        images: [],
        platforms: [
          { igdbId: null, name: 'PlayStation 5', abbreviation: null },
        ],
        source: 'MobyGames',
        raw: { game_id: 777 },
      },
    });

    const result = await app
      .get(PhotoImportHandler)
      .handle(makeJob(id, photoRef));

    expect(result).toEqual({
      recognizedCount: 1,
      importedCount: 1,
      unrecognizedCount: 0,
    });

    const games = await test.prisma.game.findMany();
    expect(games).toHaveLength(1);
    expect(games[0]?.title).toBe('Obscure Gem');
    expect(games[0]?.source).toBe('MobyGames');

    expect(igdbResolve).toHaveBeenCalledTimes(1);
    expect(fallbackResolve).toHaveBeenCalledTimes(1);
    expect(firstCallOrder(igdbResolve)).toBeLessThan(
      firstCallOrder(fallbackResolve),
    );

    const job = await test.prisma.importJob.findUniqueOrThrow({
      where: { id },
    });
    expect(job.status).toBe('done');
    expect(existsSync(join(photoDir, photoRef))).toBe(false);
  });

  it('short-circuits a transient source and keeps the item pending for retry', async () => {
    const { id, photoRef } = await seedJob();
    vision.recognize.mockResolvedValue({
      items: [recognized('Halo')],
      countVisible: 1,
    });
    igdbResolve.mockResolvedValue({
      kind: 'transient',
      reason: 'IGDB rate-limited the request',
    });

    await expect(
      app.get(PhotoImportHandler).handle(makeJob(id, photoRef, 0, 3)),
    ).rejects.toThrow(RetryableImportError);

    // Not recognized as a permanent miss: no Game, no UnrecognizedItem, and the
    // fallback is never consulted while IGDB is only transiently unavailable.
    expect(await test.prisma.game.count()).toBe(0);
    expect(await test.prisma.unrecognizedItem.count()).toBe(0);
    expect(
      await test.prisma.recognizedItem.count({ where: { status: 'pending' } }),
    ).toBe(1);
    expect(fallbackResolve).not.toHaveBeenCalled();
  });
});
