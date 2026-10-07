import type { INestApplication } from '@nestjs/common';
import { readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Job } from 'bullmq';
import { ChainedGameCatalogResolver } from '../../src/game-catalog/chained-game-catalog.resolver';
import { GameCatalogResolver } from '../../src/game-catalog/game-catalog.resolver';
import { IgdbGameCatalogResolver } from '../../src/game-catalog/igdb-game-catalog.resolver';
import { IgdbClient, type IgdbGame } from '../../src/game-catalog/igdb.client';
import { MobygamesGameCatalogResolver } from '../../src/game-catalog/mobygames-game-catalog.resolver';
import {
  MobygamesClient,
  type MobygameGame,
} from '../../src/game-catalog/mobygames.client';
import { CoverCacheService } from '../../src/covers/cover-cache.service';
import { PhotoStorageService } from '../../src/import-jobs/photo-storage.service';
import { PhotoImportHandler } from '../../src/queue/photo-import.handler';
import type { PhotoImportJobData } from '../../src/queue/photo-import.types';
import type {
  RecognizedItem,
  VisionRecognitionResult,
} from '../../src/settings/vision/vision-provider';
import { VisionService } from '../../src/settings/vision/vision.service';
import { resetDatabase } from '../helpers/reset';
import { seedPlatform } from '../helpers/seed';
import { createTestApp, type TestApp } from '../helpers/test-app';

const E2E_PHOTO_DIR_SUFFIX = 'gameshelf-import-photos-e2e';

function clearPhotoDir(dir: string): void {
  if (!resolve(dir).endsWith(E2E_PHOTO_DIR_SUFFIX)) {
    throw new Error(`Refusing to delete photo directory "${dir}"`);
  }
  rmSync(dir, { recursive: true, force: true });
}

/** The shared sanitised IGDB payload (a recorded `/v4/games` element). */
function igdbGameFixture(): IgdbGame {
  return JSON.parse(
    readFileSync(
      join(__dirname, '..', 'fixtures', 'igdb', 'halo-game.json'),
      'utf8',
    ),
  ) as IgdbGame;
}

/** The shared sanitised MobyGames payload (a recorded `/v2/games` element). */
function mobyGameFixture(): MobygameGame {
  return JSON.parse(
    readFileSync(
      join(__dirname, '..', 'fixtures', 'mobygames', 'halo-game.json'),
      'utf8',
    ),
  ) as MobygameGame;
}

function recognized(title: string, platform: string | null): RecognizedItem {
  return { title, edition: null, platform, confidence: 0.9 };
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

/** The call order of a mock's first invocation, asserting it was called. */
function firstCallOrder(mock: jest.Mock): number {
  const order = mock.mock.invocationCallOrder[0];
  if (order === undefined) {
    throw new Error('expected the source to have been called');
  }
  return order;
}

/**
 * The full validation sequence (ticket 4.9) with the **real**
 * `ChainedGameCatalogResolver` and the real IGDB/MobyGames resolvers, faking only
 * the HTTP clients (and the cover cache) so the suite makes no live API call.
 * Covers the three outcomes (IGDB hit, MobyGames fall-through, unrecognized) and
 * canonical platform matching end to end through the real import pipeline.
 */
describe('Catalog validation sequence (e2e)', () => {
  let test: TestApp;
  let app: INestApplication;
  let photoDir: string;
  let vision: { recognize: jest.Mock };
  let covers: { cacheFromUrl: jest.Mock };
  let igdbSearch: jest.Mock;
  let mobySearch: jest.Mock;
  let fetchSpy: jest.SpyInstance;

  beforeAll(async () => {
    igdbSearch = jest.fn();
    mobySearch = jest.fn();
    const igdb = {
      searchGames: igdbSearch,
      multiqueryGames: jest.fn(),
      fetchPlatforms: jest.fn(),
      checkHealth: jest.fn(),
      onApplicationBootstrap: jest.fn(),
    };
    const moby = { searchGames: mobySearch };
    const resolver = new ChainedGameCatalogResolver([
      new IgdbGameCatalogResolver(igdb as unknown as IgdbClient),
      new MobygamesGameCatalogResolver(moby as unknown as MobygamesClient),
    ]);
    vision = {
      recognize: jest.fn((): Promise<VisionRecognitionResult> =>
        Promise.resolve({ items: [], countVisible: null }),
      ),
    };
    // A real cover download would fetch images.igdb.com / cdn.mobygames.com (a
    // live call); the override keeps the mapping-only path and the fetch guard.
    covers = { cacheFromUrl: jest.fn(() => Promise.resolve(null)) };
    fetchSpy = jest.spyOn(globalThis, 'fetch');
    test = await createTestApp([
      { provide: VisionService, useValue: vision },
      { provide: IgdbClient, useValue: igdb },
      { provide: MobygamesClient, useValue: moby },
      { provide: GameCatalogResolver, useValue: resolver },
      { provide: CoverCacheService, useValue: covers },
    ]);
    app = test.app;
    photoDir = app.get(PhotoStorageService).directory;
  });

  beforeEach(async () => {
    await resetDatabase(test.prisma);
    clearPhotoDir(photoDir);
    vision.recognize.mockReset();
    vision.recognize.mockResolvedValue({ items: [], countVisible: null });
    covers.cacheFromUrl.mockClear();
    igdbSearch.mockReset();
    mobySearch.mockReset();
  });

  afterAll(async () => {
    // The explicit "no live API" proof: every HTTP seam is faked, so the real
    // `fetch` must never have been touched across the whole suite.
    const fetchCalls = fetchSpy.mock.calls.length;
    fetchSpy.mockRestore();
    await app.close();
    clearPhotoDir(photoDir);
    expect(fetchCalls).toBe(0);
  });

  /** Writes a photo and creates a queued import job (no platform seeded). */
  async function seedJob(): Promise<{ id: number; photoRef: string }> {
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

  it('saves an IGDB hit and resolves the canonical platform by IGDB id', async () => {
    const platform = await seedPlatform(test.prisma, {
      name: 'Xbox',
      slug: 'xbox',
      abbreviation: 'XBOX',
      igdbId: 11,
    });
    igdbSearch.mockResolvedValue([igdbGameFixture()]);
    vision.recognize.mockResolvedValue({
      items: [recognized('Halo: Combat Evolved', 'Xbox')],
      countVisible: 1,
    });
    const { id, photoRef } = await seedJob();

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
    expect(games[0]).toMatchObject({
      title: 'Halo: Combat Evolved',
      source: 'IGDB',
      externalId: 1036,
      releaseYear: 2001,
      publisher: 'Bungie',
      genre: 'Shooter',
      playerCount: 16,
      platformId: platform.id,
      coverUrl: null,
    });
    // The IGDB source matched, so the fallback is never consulted.
    expect(mobySearch).not.toHaveBeenCalled();
  });

  it('falls through to MobyGames and resolves the canonical platform by name', async () => {
    // No `igdbId`: the MobyGames candidate has none, so the platform can only
    // be matched by (anchored, normalized) name — the name path end to end.
    const platform = await seedPlatform(test.prisma, {
      name: 'Xbox',
      slug: 'xbox',
    });
    igdbSearch.mockResolvedValue([]);
    mobySearch.mockResolvedValue([mobyGameFixture()]);
    vision.recognize.mockResolvedValue({
      items: [recognized('Halo: Combat Evolved', 'Xbox')],
      countVisible: 1,
    });
    const { id, photoRef } = await seedJob();

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
    expect(games[0]).toMatchObject({
      title: 'Halo: Combat Evolved',
      source: 'MobyGames',
      externalId: 1201,
      platformId: platform.id,
    });

    expect(igdbSearch).toHaveBeenCalledTimes(1);
    expect(mobySearch).toHaveBeenCalledTimes(1);
    expect(firstCallOrder(igdbSearch)).toBeLessThan(firstCallOrder(mobySearch));
  });

  it('flags an unrecognized title and persists it', async () => {
    igdbSearch.mockResolvedValue([]);
    mobySearch.mockResolvedValue([]);
    vision.recognize.mockResolvedValue({
      items: [recognized('Zorblax Chronicles 9000', 'Xbox')],
      countVisible: 1,
    });
    const { id, photoRef } = await seedJob();

    const result = await app
      .get(PhotoImportHandler)
      .handle(makeJob(id, photoRef));

    expect(result).toEqual({
      recognizedCount: 1,
      importedCount: 0,
      unrecognizedCount: 1,
    });
    expect(await test.prisma.game.count()).toBe(0);
    const flagged = await test.prisma.unrecognizedItem.findMany();
    expect(flagged).toHaveLength(1);
    expect(flagged[0]?.rawTitle).toBe('Zorblax Chronicles 9000');
    // The aggregated reason from the real chain names every source consulted.
    expect(flagged[0]?.reason).toBe(
      'No game matched the title in any source — IGDB: No IGDB game matched the title; MobyGames: No MobyGames game matched the title',
    );
  });
});
