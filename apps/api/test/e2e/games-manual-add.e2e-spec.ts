import type { INestApplication } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  GameCatalogResolver,
  type CatalogCandidate,
  type CatalogResolution,
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
const COVER_URL_A =
  'https://images.igdb.com/igdb/image/upload/t_thumb/halo-a.jpg';
const COVER_BYTES = Buffer.from('fake-cover-bytes');

interface EnrichPlatformBody {
  igdbId: number | null;
  name: string;
  abbreviation: string | null;
}

interface EnrichCandidateBody {
  externalId: number;
  title: string;
  releaseYear: number | null;
  publisher: string | null;
  genre: string | null;
  playerCount: number | null;
  coverUrl: string | null;
  platforms: EnrichPlatformBody[];
  source: string;
  raw?: unknown;
}

interface GameDetailBody {
  id: number;
  title: string;
  platformId: number;
  edition: string | null;
  releaseYear: number | null;
  publisher: string | null;
  genre: string | null;
  playerCount: number | null;
  copyCount: number;
  coverUrl: string | null;
  source: string;
  externalId: number | null;
  platform: { id: number; name: string; slug: string };
}

interface GameSearchBody {
  candidates: EnrichCandidateBody[];
}

interface ConflictBody {
  code: string;
  message: string;
  game: GameDetailBody;
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

function candidate(
  overrides: Partial<CatalogCandidate> = {},
): CatalogCandidate {
  return {
    externalId: 1036,
    title: 'Halo: Combat Evolved',
    releaseYear: 2001,
    publisher: 'Bungie',
    genre: 'Shooter',
    playerCount: 16,
    coverUrl: COVER_URL_A,
    platforms: [{ igdbId: 11, name: 'Xbox', abbreviation: 'XBOX' }],
    source: 'IGDB',
    raw: { id: 1036 },
    ...overrides,
  };
}

function matched(overrides: Partial<CatalogCandidate> = {}): CatalogResolution {
  return { kind: 'matched', candidate: candidate(overrides) };
}

function searchMatches(
  overrides: Partial<CatalogCandidate> = {},
): CatalogSearchResult {
  return { kind: 'matches', candidates: [candidate(overrides)] };
}

function imageResponse(body: Buffer): CoverHttpResponse {
  return { ok: true, status: 200, contentType: 'image/jpeg', body };
}

describe('Manual add (e2e)', () => {
  let test: TestApp;
  let app: INestApplication;
  let coversDir: string;
  let resolver: { resolve: jest.Mock; search: jest.Mock };
  let coverHttp: { get: jest.Mock<Promise<CoverHttpResponse>, [string]> };

  beforeAll(async () => {
    resolver = { resolve: jest.fn(), search: jest.fn() };
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
    resolver.resolve.mockReset();
    resolver.search.mockReset();
    coverHttp.get.mockReset();
    await test.login();
  });

  afterAll(async () => {
    await app.close();
    clearCoversDir(coversDir);
  });

  async function seedPlatformRow(): Promise<number> {
    const platform = await seedPlatform(test.prisma, {
      name: PLATFORM_NAME,
      slug: PLATFORM_SLUG,
    });
    return platform.id;
  }

  describe('GET /games/search', () => {
    it('returns ranked candidates with metadata and a same-origin preview cover', async () => {
      resolver.search.mockResolvedValue(searchMatches());

      const res = await test.request.get('/games/search').query({ q: 'halo' });

      expect(res.status).toBe(200);
      const body = res.body as GameSearchBody;
      expect(body.candidates).toHaveLength(1);
      expect(body.candidates[0]).toMatchObject({
        externalId: 1036,
        title: 'Halo: Combat Evolved',
        releaseYear: 2001,
        publisher: 'Bungie',
        genre: 'Shooter',
        playerCount: 16,
        source: 'IGDB',
      });
      // The candidate cover is a same-origin signed preview, never external.
      expect(body.candidates[0]?.coverUrl).toMatch(
        /^\/api\/covers\/preview\?u=/,
      );
      expect(body.candidates[0]?.coverUrl).not.toContain('images.igdb.com');
      // The archival raw payload is never exposed.
      expect(body.candidates[0]?.raw).toBeUndefined();
      expect(resolver.search).toHaveBeenCalledTimes(1);
      expect(resolver.search).toHaveBeenCalledWith('halo');
    });

    it('returns [] without calling the resolver below the minimum length', async () => {
      const res = await test.request.get('/games/search').query({ q: 'h' });

      expect(res.status).toBe(200);
      expect(res.body as GameSearchBody).toEqual({ candidates: [] });
      expect(resolver.search).not.toHaveBeenCalled();
    });

    it('coalesces/caches identical queries within the TTL (one upstream call)', async () => {
      resolver.search.mockResolvedValue(searchMatches({ title: 'Zelda' }));

      const first = await test.request
        .get('/games/search')
        .query({ q: 'zelda' });
      const second = await test.request
        .get('/games/search')
        .query({ q: 'zelda' });
      const [third, fourth] = await Promise.all([
        test.request.get('/games/search').query({ q: 'zelda' }),
        test.request.get('/games/search').query({ q: 'zelda' }),
      ]);

      for (const res of [first, second, third, fourth]) {
        expect(res.status).toBe(200);
        expect((res.body as GameSearchBody).candidates).toHaveLength(1);
      }
      expect(resolver.search).toHaveBeenCalledTimes(1);
    });

    it('maps a config_error to 503', async () => {
      resolver.search.mockResolvedValue({
        kind: 'config_error',
        source: 'igdb',
        reason: 'IGDB rejected the credentials',
      });

      const res = await test.request.get('/games/search').query({ q: 'mario' });

      expect(res.status).toBe(503);
    });
  });

  describe('POST /games', () => {
    it('creates a linked game from a picked candidate with a cached same-origin cover', async () => {
      const platformId = await seedPlatformRow();
      resolver.search.mockResolvedValue(searchMatches());
      coverHttp.get.mockResolvedValue(imageResponse(COVER_BYTES));

      const res = await test.request.post('/games').send({
        title: 'Halo: Combat Evolved',
        platformId,
        candidate: { source: 'IGDB', externalId: 1036 },
      });

      expect(res.status).toBe(201);
      const body = res.body as GameDetailBody;
      expect(body.source).toBe('IGDB');
      expect(body.externalId).toBe(1036);
      expect(body.copyCount).toBe(1);
      expect(coverHttp.get).toHaveBeenCalledWith(COVER_URL_A);
      expect(body.coverUrl).toBe(servedCover(COVER_URL_A));
      expect(body).not.toHaveProperty('sourceCoverUrl');
      expect(await test.prisma.game.count()).toBe(1);
    });

    it('leaves platform/edition to the confirmed inputs on a picked candidate', async () => {
      const platformId = await seedPlatformRow();
      resolver.search.mockResolvedValue(searchMatches());
      coverHttp.get.mockResolvedValue(imageResponse(COVER_BYTES));

      const res = await test.request.post('/games').send({
        title: 'Metroid Prime',
        platformId,
        edition: 'GOTY Edition',
        candidate: { source: 'IGDB', externalId: 1036 },
      });

      expect(res.status).toBe(201);
      const body = res.body as GameDetailBody;
      expect(body.platformId).toBe(platformId);
      expect(body.edition).toBe('GOTY Edition');
      // Re-verification runs against the submitted title.
      expect(resolver.search).toHaveBeenCalledWith('Metroid Prime');
    });

    it('rejects a pick that no longer appears in a fresh search (409)', async () => {
      const platformId = await seedPlatformRow();
      resolver.search.mockResolvedValue({ kind: 'matches', candidates: [] });

      const res = await test.request.post('/games').send({
        title: 'Sonic',
        platformId,
        candidate: { source: 'IGDB', externalId: 999 },
      });

      expect(res.status).toBe(409);
      expect(await test.prisma.game.count()).toBe(0);
    });

    it('saves typed data as MANUAL with externalId null when no candidate is given', async () => {
      const platformId = await seedPlatformRow();

      const res = await test.request.post('/games').send({
        title: 'Chrono Trigger',
        platformId,
        edition: 'DS',
        releaseYear: 2008,
        publisher: 'Square Enix',
        genre: 'RPG',
        playerCount: 1,
      });

      expect(res.status).toBe(201);
      const body = res.body as GameDetailBody;
      expect(body.source).toBe('MANUAL');
      expect(body.externalId).toBeNull();
      expect(body.copyCount).toBe(1);
      expect(body.releaseYear).toBe(2008);
      expect(body).not.toHaveProperty('sourceCoverUrl');
      expect(resolver.search).not.toHaveBeenCalled();
    });

    it('still saves typed MANUAL data when the search API reports config_error', async () => {
      const platformId = await seedPlatformRow();
      resolver.search.mockResolvedValue({
        kind: 'config_error',
        source: 'igdb',
        reason: 'IGDB rejected the credentials',
      });

      const searchRes = await test.request
        .get('/games/search')
        .query({ q: 'mario' });
      expect(searchRes.status).toBe(503);

      const res = await test.request
        .post('/games')
        .send({ title: 'Fallback Game', platformId });

      expect(res.status).toBe(201);
      expect((res.body as GameDetailBody).source).toBe('MANUAL');
    });

    it('returns 409 with the existing game on a duplicate identity, then increments copies', async () => {
      const platformId = await seedPlatformRow();
      const payload = {
        title: 'Chrono Trigger',
        platformId,
        edition: 'DS',
      };

      const first = await test.request.post('/games').send(payload);
      expect(first.status).toBe(201);
      const firstBody = first.body as GameDetailBody;

      const second = await test.request.post('/games').send(payload);
      expect(second.status).toBe(409);
      const conflict = second.body as ConflictBody;
      expect(conflict.code).toBe('GAME_ALREADY_IN_CATALOG');
      expect(conflict.game.id).toBe(firstBody.id);

      // No second row was created.
      expect(await test.prisma.game.count()).toBe(1);

      const copy = await test.request.post(
        `/games/${String(firstBody.id)}/copies`,
      );
      expect(copy.status).toBe(200);
      expect((copy.body as GameDetailBody).copyCount).toBe(2);

      // Still exactly one catalog row; detail exposes the incremented count.
      expect(await test.prisma.game.count()).toBe(1);
      const detail = await test.request.get(`/games/${String(firstBody.id)}`);
      expect(detail.status).toBe(200);
      expect((detail.body as GameDetailBody).copyCount).toBe(2);

      const list = await test.request.get('/games');
      expect(list.status).toBe(200);
      expect((list.body as { meta: { total: number } }).meta.total).toBe(1);
    });

    it('treats two unlinked games with the same normalized title/platform/edition as one identity', async () => {
      const platformId = await seedPlatformRow();

      const first = await test.request.post('/games').send({
        title: 'Pokémon: Édition Rouge',
        platformId,
        edition: 'GOTY',
      });
      expect(first.status).toBe(201);

      const second = await test.request.post('/games').send({
        title: 'pokemon edition rouge',
        platformId,
        edition: 'goty',
      });
      expect(second.status).toBe(409);
      expect((second.body as ConflictBody).code).toBe(
        'GAME_ALREADY_IN_CATALOG',
      );
      expect(await test.prisma.game.count()).toBe(1);
    });
  });

  describe('POST /games/:id/copies', () => {
    it('returns 404 for an unknown game', async () => {
      const res = await test.request.post('/games/999999/copies');

      expect(res.status).toBe(404);
    });

    it('is idempotent-safe across repeated increments', async () => {
      const platformId = await seedPlatformRow();
      const created = await test.request
        .post('/games')
        .send({ title: 'Hades', platformId });
      const id = (created.body as GameDetailBody).id;

      await test.request.post(`/games/${String(id)}/copies`);
      const second = await test.request.post(`/games/${String(id)}/copies`);

      expect(second.status).toBe(200);
      expect((second.body as GameDetailBody).copyCount).toBe(3);
    });
  });

  // The `matched()`/`resolve` seam is only used by re-enrichment; kept so the
  // override satisfies the full resolver contract.
  it('still supports the resolve path for re-enrichment', async () => {
    const platformId = await seedPlatformRow();
    const game = await test.prisma.game.create({
      data: { title: 'Halo', platformId },
    });
    resolver.resolve.mockResolvedValue(matched());

    const res = await test.request
      .post(`/games/${String(game.id)}/enrich`)
      .send({});

    expect(res.status).toBe(200);
  });
});
