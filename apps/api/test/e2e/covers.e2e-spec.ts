import type { INestApplication } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import { Queue } from 'bullmq';
import type { Job } from 'bullmq';
import sharp from 'sharp';
import type { Response as SuperAgentResponse } from 'superagent';
import supertest from 'supertest';
import { CoverCacheService } from '../../src/covers/cover-cache.service';
import {
  CoverHttpClient,
  type CoverHttpResponse,
} from '../../src/covers/cover-http.client';
import { CoverPreviewService } from '../../src/covers/cover-preview.service';
import { CoverRecoveryService } from '../../src/covers/cover-recovery.service';
import type {
  CatalogCandidate,
  CatalogResolution,
} from '../../src/game-catalog/game-catalog.resolver';
import { GameCatalogResolver } from '../../src/game-catalog/game-catalog.resolver';
import { PhotoImportHandler } from '../../src/queue/photo-import.handler';
import { PhotoStorageService } from '../../src/import-jobs/photo-storage.service';
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
const E2E_COVERS_DIR_SUFFIX = 'gameshelf-covers-e2e';
const PLATFORM_IGDB_ID = 167;
const COVER_URL = 'https://images.igdb.com/igdb/image/upload/t_thumb/halo.jpg';
let COVER_BYTES: Buffer;

function clearCoversDir(dir: string): void {
  if (!resolve(dir).endsWith(E2E_COVERS_DIR_SUFFIX)) {
    throw new Error(`Refusing to delete covers directory "${dir}"`);
  }
  rmSync(dir, { recursive: true, force: true });
}

function recognized(title: string): RecognizedItem {
  return { title, edition: null, platform: 'PlayStation 5', confidence: 0.9 };
}

function candidate(title: string): CatalogCandidate {
  return {
    externalId: 7,
    title,
    releaseYear: 2001,
    publisher: 'Bungie',
    genre: 'Shooter',
    playerCount: 16,
    coverUrl: COVER_URL,
    platforms: [
      { igdbId: PLATFORM_IGDB_ID, name: 'PlayStation 5', abbreviation: 'PS5' },
    ],
    source: 'IGDB',
    raw: { id: 7 },
  };
}

function makeJob(
  importJobId: number,
  photoRef: string,
): Job<PhotoImportJobData> {
  return {
    id: `covers-${String(importJobId)}`,
    attemptsMade: 0,
    opts: { attempts: 3 },
    data: { photoRef, importJobId },
  } as unknown as Job<PhotoImportJobData>;
}

function imageResponse(body: Buffer): CoverHttpResponse {
  return { ok: true, status: 200, contentType: 'image/jpeg', body };
}

/** superagent parser that keeps an image response body as raw bytes. */
function binaryParser(
  res: SuperAgentResponse,
  callback: (error: Error | null, body: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => {
    callback(null, Buffer.concat(chunks));
  });
}

describe('Cover cache (e2e)', () => {
  let test: TestApp;
  let app: INestApplication;
  let queue: Queue;
  let coversDir: string;
  let vision: { recognize: jest.Mock };
  let resolver: { resolve: jest.Mock };
  let coverHttp: { get: jest.Mock<Promise<CoverHttpResponse>, [string]> };

  beforeAll(async () => {
    COVER_BYTES = await sharp({
      create: {
        width: 600,
        height: 600,
        channels: 3,
        background: { r: 200, g: 100, b: 50 },
      },
    })
      .png()
      .toBuffer();
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
    coverHttp = { get: jest.fn<Promise<CoverHttpResponse>, [string]>() };
    test = await createTestApp([
      { provide: VisionService, useValue: vision },
      { provide: GameCatalogResolver, useValue: resolver },
      { provide: CoverHttpClient, useValue: coverHttp },
    ]);
    app = test.app;
    coversDir = app.get(CoverCacheService).directory;
    queue = new Queue(PHOTO_IMPORT_QUEUE, { connection, prefix: queuePrefix });
  });

  beforeEach(async () => {
    await resetDatabase(test.prisma);
    await queue.obliterate({ force: true });
    await queue.resume();
    clearCoversDir(coversDir);
    vision.recognize.mockReset();
    vision.recognize.mockResolvedValue({ items: [], countVisible: null });
    resolver.resolve.mockReset();
    coverHttp.get.mockReset();
  });

  afterAll(async () => {
    await queue.close();
    await app.close();
    clearCoversDir(coversDir);
  });

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
      data: { status: 'queued', declaredCount: 1, photoRef },
    });
    return { id: row.id, photoRef };
  }

  it('saves a game with a locally cached same-origin cover and serves it back', async () => {
    const { id, photoRef } = await seedJob();
    vision.recognize.mockResolvedValue({
      items: [recognized('Halo: Combat Evolved')],
      countVisible: 1,
    });
    resolver.resolve.mockResolvedValue({
      kind: 'matched',
      candidate: candidate('Halo: Combat Evolved'),
    });
    coverHttp.get.mockResolvedValue(imageResponse(COVER_BYTES));

    const result = await app
      .get(PhotoImportHandler)
      .handle(makeJob(id, photoRef));

    expect(result).toEqual({
      recognizedCount: 1,
      importedCount: 1,
      unrecognizedCount: 0,
    });
    expect(coverHttp.get).toHaveBeenCalledWith(COVER_URL);

    const game = await test.prisma.game.findFirstOrThrow();
    const expectedHash = createHash('sha256')
      .update(COVER_URL)
      .digest('hex')
      .slice(0, 32);
    expect(game.coverUrl).toBe(`/api/covers/${expectedHash}.jpg`);
    expect(game.coverUrl).toMatch(/^\/api\/covers\/[a-f0-9]{32}\.jpg$/);
    // The full accepted candidate field set is proven at pipeline level.
    const platform = await test.prisma.platform.findFirstOrThrow({
      where: { slug: 'playstation-5' },
    });
    expect(game.title).toBe('Halo: Combat Evolved');
    expect(game.platformId).toBe(platform.id);
    expect(game.releaseYear).toBe(2001);
    expect(game.publisher).toBe('Bungie');
    expect(game.genre).toBe('Shooter');
    expect(game.playerCount).toBe(16);
    expect(game.source).toBe('IGDB');
    expect(game.externalId).toBe(7);
    expect(game.enrichedAt).not.toBeNull();
    expect(JSON.parse(game.rawMetadata ?? '')).toEqual({ id: 7 });

    const job = await test.prisma.importJob.findUniqueOrThrow({
      where: { id },
    });
    expect(job.status).toBe('done');
    expect(job.importedCount).toBe(1);

    const file = (game.coverUrl ?? '').split('/').pop() ?? '';

    // The route is authenticated: an anonymous request is rejected.
    const anon = await supertest(app.getHttpServer() as Server).get(
      `/covers/${file}`,
    );
    expect(anon.status).toBe(401);

    // Authenticated, the app serves the cached bytes from its own origin.
    await test.login();
    const served = await test.request
      .get(`/covers/${file}`)
      .buffer(true)
      .parse(binaryParser);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toContain('image/jpeg');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(served.headers['cache-control']).toBe(
      'private, max-age=31536000, immutable',
    );
    expect(served.body as Buffer).toEqual(COVER_BYTES);

    // A locally generated thumbnail is served from our own origin (WebP,
    // smaller than the stored cover) — never from a CDN.
    const thumb = await test.request
      .get(`/covers/thumbs/${file}`)
      .buffer(true)
      .parse(binaryParser);
    expect(thumb.status).toBe(200);
    expect(thumb.headers['content-type']).toContain('image/webp');
    expect(thumb.headers['x-content-type-options']).toBe('nosniff');
    expect(thumb.headers.location).toBeUndefined();
    expect((thumb.body as Buffer).length).toBeLessThan(COVER_BYTES.length);
    const storedThumb = await app.get(CoverCacheService).readThumbnail(file);
    expect(storedThumb?.mimeType).toBe('image/webp');
  });

  it('deletes the stored cover file and thumbnail with the game', async () => {
    const { id, photoRef } = await seedJob();
    vision.recognize.mockResolvedValue({
      items: [recognized('Halo: Combat Evolved')],
      countVisible: 1,
    });
    resolver.resolve.mockResolvedValue({
      kind: 'matched',
      candidate: candidate('Halo: Combat Evolved'),
    });
    coverHttp.get.mockResolvedValue(imageResponse(COVER_BYTES));

    await app.get(PhotoImportHandler).handle(makeJob(id, photoRef));
    const game = await test.prisma.game.findFirstOrThrow();
    const file = (game.coverUrl ?? '').split('/').pop() ?? '';

    const cache = app.get(CoverCacheService);
    await expect(cache.has(file)).resolves.toBe(true);
    await expect(cache.readThumbnail(file)).resolves.not.toBeNull();

    await test.login();
    const del = await test.request.delete(`/games/${String(game.id)}`);
    expect(del.status).toBe(204);

    await expect(cache.has(file)).resolves.toBe(false);
    await expect(cache.readThumbnail(file)).resolves.toBeNull();
  });

  it('saves the game with a null coverUrl when the download fails', async () => {
    const { id, photoRef } = await seedJob();
    vision.recognize.mockResolvedValue({
      items: [recognized('Halo: Combat Evolved')],
      countVisible: 1,
    });
    resolver.resolve.mockResolvedValue({
      kind: 'matched',
      candidate: candidate('Halo: Combat Evolved'),
    });
    coverHttp.get.mockRejectedValue(new Error('network down'));

    const result = await app
      .get(PhotoImportHandler)
      .handle(makeJob(id, photoRef));

    expect(result).toEqual({
      recognizedCount: 1,
      importedCount: 1,
      unrecognizedCount: 0,
    });
    const game = await test.prisma.game.findFirstOrThrow();
    expect(game.coverUrl).toBeNull();
    // The external link is retained so the background retry can heal the cover.
    expect(game.sourceCoverUrl).toBe(COVER_URL);
    expect(game.title).toBe('Halo: Combat Evolved');
    const job = await test.prisma.importJob.findUniqueOrThrow({
      where: { id },
    });
    expect(job.status).toBe('done');
    expect(job.importedCount).toBe(1);
    // The cover failure never fails the import item (asserted above).

    // A later background retry succeeds and restores the cover + thumbnail.
    coverHttp.get.mockResolvedValue(imageResponse(COVER_BYTES));
    const recovery = app.get(CoverRecoveryService);
    await expect(recovery.refreshGame(game.id)).resolves.toBe(true);
    const retried = await test.prisma.game.findUniqueOrThrow({
      where: { id: game.id },
    });
    expect(retried.coverUrl).toMatch(/^\/api\/covers\/[a-f0-9]{32}\.jpg$/);
    const restoredFile = (retried.coverUrl ?? '').split('/').pop() ?? '';
    await expect(
      app.get(CoverCacheService).readThumbnail(restoredFile),
    ).resolves.not.toBeNull();
  });

  it('serves an unsaved candidate through a signed same-origin preview', async () => {
    await test.login();
    coverHttp.get.mockResolvedValue(imageResponse(COVER_BYTES));
    const previewUrl = app.get(CoverPreviewService).previewUrl(COVER_URL);
    if (previewUrl === null) {
      throw new Error('expected a preview URL');
    }
    // The browser never learns the external host.
    expect(previewUrl).not.toContain('images.igdb.com');
    const query = previewUrl.slice(previewUrl.indexOf('?'));

    const signed = await test.request
      .get(`/covers/preview${query}`)
      .buffer(true)
      .parse(binaryParser);
    expect(signed.status).toBe(200);
    expect(signed.headers['content-type']).toContain('image/webp');
    expect(signed.headers.location).toBeUndefined();
    expect(coverHttp.get).toHaveBeenCalledWith(COVER_URL);

    // Tampering with the signature or omitting it yields a 404, never a redirect.
    const tampered = await test.request.get(
      `/covers/preview${query.replace(/s=[^&]*/, 's=tampered')}`,
    );
    expect(tampered.status).toBe(404);
    expect(tampered.headers.location).toBeUndefined();

    const unsigned = await test.request.get('/covers/preview');
    expect(unsigned.status).toBe(404);
  });
});
