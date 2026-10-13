import type { INestApplication } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import type { Response as SuperAgentResponse } from 'superagent';
import {
  GameCatalogResolver,
  type CatalogCandidate,
  type CatalogSearchResult,
} from '../../src/game-catalog/game-catalog.resolver';
import { CoverCacheService } from '../../src/covers/cover-cache.service';
import {
  CoverHttpClient,
  type CoverHttpResponse,
} from '../../src/covers/cover-http.client';
import { resetDatabase } from '../helpers/reset';
import { seedPlatform } from '../helpers/seed';
import { createTestApp, type TestApp } from '../helpers/test-app';

const E2E_COVERS_DIR_SUFFIX = 'gameshelf-covers-e2e';
const PLATFORM_NAME = 'PlayStation 5';
const PLATFORM_SLUG = 'playstation-5';
const PLATFORM_IGDB_ID = 167;
const COVER_URL = 'https://images.igdb.com/igdb/image/upload/t_1080p/cover.jpg';
const ART_URL = 'https://images.igdb.com/igdb/image/upload/t_1080p/art.jpg';
const SHOT_URL = 'https://images.igdb.com/igdb/image/upload/t_1080p/shot.jpg';

interface GameImageBody {
  url: string;
  thumbUrl: string | null;
}

interface GameDetailBody {
  id: string;
  title: string;
  coverUrl: string | null;
  images: GameImageBody[];
  rawMetadata: string | null;
}

function clearCoversDir(dir: string): void {
  if (!resolve(dir).endsWith(E2E_COVERS_DIR_SUFFIX)) {
    throw new Error(`Refusing to delete covers directory "${dir}"`);
  }
  rmSync(dir, { recursive: true, force: true });
}

/** The same-origin path `CoverCacheService` derives for a cover URL. */
function servedCover(url: string): string {
  const hash = createHash('sha256').update(url).digest('hex').slice(0, 32);
  return `/api/covers/${hash}.jpg`;
}

/** The same-origin thumbnail path for a served image URL. */
function servedThumb(servedUrl: string): string {
  return servedUrl.replace('/api/covers/', '/api/covers/thumbs/');
}

function candidate(): CatalogCandidate {
  return {
    externalId: 1036,
    title: 'Halo: Combat Evolved',
    releaseYear: 2001,
    publisher: 'Bungie',
    genre: 'Shooter',
    playerCount: 16,
    coverUrl: COVER_URL,
    images: [ART_URL, SHOT_URL],
    platforms: [
      { igdbId: PLATFORM_IGDB_ID, name: PLATFORM_NAME, abbreviation: 'PS5' },
    ],
    source: 'IGDB',
    raw: { id: 1036 },
  };
}

function searchMatches(): CatalogSearchResult {
  return { kind: 'matches', candidates: [candidate()] };
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

async function png(
  width: number,
  height: number,
  background: { r: number; g: number; b: number },
): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background } })
    .png()
    .toBuffer();
}

describe('Game gallery (e2e)', () => {
  let test: TestApp;
  let app: INestApplication;
  let coversDir: string;
  let resolver: { search: jest.Mock };
  let coverHttp: { get: jest.Mock<Promise<CoverHttpResponse>, [string]> };
  let bytes: Record<string, Buffer>;

  beforeAll(async () => {
    bytes = {
      [COVER_URL]: await png(120, 160, { r: 200, g: 100, b: 50 }),
      [ART_URL]: await png(160, 90, { r: 50, g: 150, b: 200 }),
      [SHOT_URL]: await png(160, 90, { r: 30, g: 180, b: 80 }),
    };
    resolver = { search: jest.fn() };
    coverHttp = { get: jest.fn<Promise<CoverHttpResponse>, [string]>() };
    test = await createTestApp([
      { provide: GameCatalogResolver, useValue: resolver },
      { provide: CoverHttpClient, useValue: coverHttp },
    ]);
    app = test.app;
    coversDir = app.get(CoverCacheService).directory;
  });

  beforeEach(async () => {
    await resetDatabase(test.prisma);
    clearCoversDir(coversDir);
    resolver.search.mockReset();
    coverHttp.get.mockReset();
    coverHttp.get.mockImplementation((url: string) =>
      Promise.resolve(
        imageResponse(bytes[url] ?? bytes[COVER_URL] ?? Buffer.from('x')),
      ),
    );
    await test.login();
  });

  afterAll(async () => {
    await app.close();
    clearCoversDir(coversDir);
  });

  async function seedPlatformRow(): Promise<string> {
    const platform = await seedPlatform(test.prisma, {
      name: PLATFORM_NAME,
      slug: PLATFORM_SLUG,
      igdbId: PLATFORM_IGDB_ID,
    });
    return platform.id;
  }

  async function createGame(): Promise<GameDetailBody> {
    const platformId = await seedPlatformRow();
    resolver.search.mockResolvedValue(searchMatches());
    const created = await test.request.post('/games').send({
      title: 'Halo',
      platformId,
      edition: 'GOTY',
      candidate: { source: 'IGDB', externalId: 1036 },
    });
    expect(created.status).toBe(201);
    return created.body as GameDetailBody;
  }

  it('caches the candidate gallery and serves it same-origin from the detail API', async () => {
    const created = await createGame();

    expect(coverHttp.get).toHaveBeenCalledWith(COVER_URL);
    expect(coverHttp.get).toHaveBeenCalledWith(ART_URL);
    expect(coverHttp.get).toHaveBeenCalledWith(SHOT_URL);

    expect(created.images).toEqual([
      {
        url: servedCover(ART_URL),
        thumbUrl: servedThumb(servedCover(ART_URL)),
      },
      {
        url: servedCover(SHOT_URL),
        thumbUrl: servedThumb(servedCover(SHOT_URL)),
      },
    ]);
    // No external host and no internal source link ever reach the response.
    expect(JSON.stringify(created.images)).not.toContain('images.igdb.com');
    expect(created).not.toHaveProperty('sourceCoverUrl');

    // Persisted rows carry the same-origin path plus the internal source link.
    const rows = await test.prisma.gameImage.findMany({
      where: { gameId: created.id },
      orderBy: { position: 'asc' },
    });
    expect(rows.map((row) => row.url)).toEqual([
      servedCover(ART_URL),
      servedCover(SHOT_URL),
    ]);
    expect(rows.map((row) => row.sourceUrl)).toEqual([ART_URL, SHOT_URL]);

    // The detail endpoint returns the ordered gallery.
    const detail = await test.request.get(`/games/${created.id}`);
    expect(detail.status).toBe(200);
    const detailBody = detail.body as GameDetailBody;
    expect(detailBody.images.map((image) => image.url)).toEqual([
      servedCover(ART_URL),
      servedCover(SHOT_URL),
    ]);
    expect(detailBody).not.toHaveProperty('sourceCoverUrl');

    // Both the full image and the locally generated thumbnail are served from
    // our own origin with the right bytes / type.
    for (const url of [ART_URL, SHOT_URL]) {
      const file = servedCover(url).split('/').pop() ?? '';
      const full = await test.request
        .get(`/covers/${file}`)
        .buffer(true)
        .parse(binaryParser);
      expect(full.status).toBe(200);
      expect(full.body as Buffer).toEqual(bytes[url]);

      const thumb = await test.request
        .get(`/covers/thumbs/${file}`)
        .buffer(true)
        .parse(binaryParser);
      expect(thumb.status).toBe(200);
      expect(thumb.headers['content-type']).toContain('image/webp');
      expect(thumb.headers.location).toBeUndefined();
    }
  });

  it('removes the gallery files and rows when the game is deleted', async () => {
    const created = await createGame();
    const rows = await test.prisma.gameImage.findMany({
      where: { gameId: created.id },
    });
    const cache = app.get(CoverCacheService);
    for (const row of rows) {
      const file = row.url.split('/').pop() ?? '';
      await expect(cache.has(file)).resolves.toBe(true);
    }

    const del = await test.request.delete(`/games/${created.id}`);
    expect(del.status).toBe(204);

    for (const row of rows) {
      const file = row.url.split('/').pop() ?? '';
      await expect(cache.has(file)).resolves.toBe(false);
    }
    await expect(
      test.prisma.gameImage.count({ where: { gameId: created.id } }),
    ).resolves.toBe(0);
  });
});
