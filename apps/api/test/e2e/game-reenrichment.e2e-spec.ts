import type { INestApplication } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import supertest from 'supertest';
import {
  GameCatalogResolver,
  type CatalogCandidate,
  type CatalogResolution,
} from '../../src/game-catalog/game-catalog.resolver';
import { CoverCacheService } from '../../src/covers/cover-cache.service';
import {
  CoverHttpClient,
  type CoverHttpResponse,
} from '../../src/covers/cover-http.client';
import { resetDatabase } from '../helpers/reset';
import { seedGame, seedPlatform } from '../helpers/seed';
import { createTestApp, type TestApp } from '../helpers/test-app';

const E2E_COVERS_DIR_SUFFIX = 'gameshelf-covers-e2e';
const PLATFORM_NAME = 'PlayStation 5';
const PLATFORM_SLUG = 'playstation-5';
const PLATFORM_IGDB_ID = 167;
const COVER_URL_A =
  'https://images.igdb.com/igdb/image/upload/t_thumb/halo-a.jpg';
const COVER_URL_B =
  'https://images.igdb.com/igdb/image/upload/t_thumb/halo-b.jpg';
const COVER_BYTES = Buffer.from('fake-cover-bytes');
const OLD_COVER = `/api/covers/${'a'.repeat(32)}.jpg`;

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
  coverUrl: string | null;
  rawMetadata: string | null;
  enrichedAt: string | null;
  source: string;
  externalId: number | null;
  platformUnverified: boolean;
  userEditedFields: string[];
  platform: { id: number; name: string; slug: string };
}

interface EnrichBody {
  status: string;
  reason: string | null;
  applied: boolean;
  candidates: EnrichCandidateBody[];
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

function imageResponse(body: Buffer): CoverHttpResponse {
  return { ok: true, status: 200, contentType: 'image/jpeg', body };
}

interface SeedOverrides {
  title?: string;
  edition?: string | null;
  releaseYear?: number | null;
  publisher?: string | null;
  genre?: string | null;
  playerCount?: number | null;
  coverUrl?: string | null;
  source?: 'IGDB' | 'MobyGames' | 'MANUAL';
  enrichedAt?: Date | null;
  rawMetadata?: string | null;
  externalId?: number | null;
  platformUnverified?: boolean;
  userEditedFields?: string | null;
}

describe('Game re-enrichment (e2e)', () => {
  let test: TestApp;
  let app: INestApplication;
  let coversDir: string;
  let resolver: { resolve: jest.Mock };
  let coverHttp: { get: jest.Mock<Promise<CoverHttpResponse>, [string]> };

  beforeAll(async () => {
    resolver = { resolve: jest.fn() };
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
    coverHttp.get.mockReset();
    await test.login();
  });

  afterAll(async () => {
    await app.close();
    clearCoversDir(coversDir);
  });

  async function seedGameWith(
    overrides: SeedOverrides = {},
  ): Promise<{ platformId: number; gameId: number }> {
    const platform = await seedPlatform(test.prisma, {
      name: PLATFORM_NAME,
      slug: PLATFORM_SLUG,
      igdbId: PLATFORM_IGDB_ID,
    });
    const game = await seedGame(test.prisma, {
      title: 'Halo',
      platformId: platform.id,
      ...overrides,
    });
    return { platformId: platform.id, gameId: game.id };
  }

  it('re-resolves a corrected title and applies fresh metadata without a duplicate', async () => {
    const { platformId, gameId } = await seedGameWith({
      title: 'Halo',
      edition: 'Standard',
    });
    resolver.resolve.mockResolvedValue(matched());
    coverHttp.get.mockResolvedValue(imageResponse(COVER_BYTES));

    const search = await test.request
      .post(`/games/${String(gameId)}/enrich`)
      .send({});
    expect(search.status).toBe(200);
    const searchBody = search.body as EnrichBody;
    expect(searchBody.status).toBe('matched');
    expect(searchBody.applied).toBe(false);
    expect(searchBody.candidates).toHaveLength(1);
    expect(searchBody.candidates[0]).toMatchObject({
      source: 'IGDB',
      externalId: 1036,
      title: 'Halo: Combat Evolved',
      releaseYear: 2001,
    });
    // The archival raw payload is never exposed.
    expect(searchBody.candidates[0]?.raw).toBeUndefined();

    // Search against the current (corrected) title, no mutation.
    expect(resolver.resolve).toHaveBeenCalledWith({
      title: 'Halo',
      edition: 'Standard',
      platform: PLATFORM_NAME,
      confidence: 1,
    });
    expect(
      (await test.prisma.game.findUniqueOrThrow({ where: { id: gameId } }))
        .releaseYear,
    ).toBeNull();

    const apply = await test.request
      .post(`/games/${String(gameId)}/enrich`)
      .send({ candidate: { source: 'IGDB', externalId: 1036 } });
    expect(apply.status).toBe(200);
    const applyBody = apply.body as EnrichBody;
    expect(applyBody.applied).toBe(true);

    expect(await test.prisma.game.count()).toBe(1);
    const game = await test.prisma.game.findUniqueOrThrow({
      where: { id: gameId },
    });
    expect(game.id).toBe(gameId);
    // Protected identity fields are untouched.
    expect(game.title).toBe('Halo');
    expect(game.platformId).toBe(platformId);
    expect(game.edition).toBe('Standard');
    // Fresh metadata.
    expect(game.releaseYear).toBe(2001);
    expect(game.publisher).toBe('Bungie');
    expect(game.genre).toBe('Shooter');
    expect(game.playerCount).toBe(16);
    expect(game.coverUrl).toBe(servedCover(COVER_URL_A));
    expect(game.source).toBe('IGDB');
    expect(game.externalId).toBe(1036);
    expect(game.enrichedAt).not.toBeNull();
    expect(JSON.parse(game.rawMetadata ?? '')).toEqual({ id: 1036 });

    // The response reflects the protected fields too.
    expect(applyBody.game.title).toBe('Halo');
    expect(applyBody.game.platformId).toBe(platformId);
    expect(applyBody.game.edition).toBe('Standard');
    expect(applyBody.game.externalId).toBe(1036);
  });

  it('reports still-unresolved without destroying existing metadata', async () => {
    const { gameId } = await seedGameWith({
      releaseYear: 1999,
      publisher: 'Original',
      genre: 'Action',
      playerCount: 4,
      coverUrl: OLD_COVER,
    });
    resolver.resolve.mockResolvedValue({
      kind: 'unrecognized',
      reason: 'No game matched the title in any source',
    });

    const res = await test.request
      .post(`/games/${String(gameId)}/enrich`)
      .send({});
    expect(res.status).toBe(200);
    const body = res.body as EnrichBody;
    expect(body.status).toBe('unrecognized');
    expect(body.candidates).toEqual([]);
    expect(body.applied).toBe(false);
    expect(body.reason).toBe('No game matched the title in any source');

    const game = await test.prisma.game.findUniqueOrThrow({
      where: { id: gameId },
    });
    expect(game.releaseYear).toBe(1999);
    expect(game.publisher).toBe('Original');
    expect(game.genre).toBe('Action');
    expect(game.playerCount).toBe(4);
    expect(game.coverUrl).toBe(OLD_COVER);
    expect(game.enrichedAt).toBeNull();
  });

  it('leaves a hand-edited publisher intact while filling the rest', async () => {
    const { gameId } = await seedGameWith({
      publisher: 'Hand Edited',
      userEditedFields: '["publisher"]',
    });
    resolver.resolve.mockResolvedValue(matched());
    coverHttp.get.mockResolvedValue(imageResponse(COVER_BYTES));

    const res = await test.request
      .post(`/games/${String(gameId)}/enrich`)
      .send({ candidate: { source: 'IGDB', externalId: 1036 } });
    expect(res.status).toBe(200);
    const body = res.body as EnrichBody;
    expect(body.applied).toBe(true);

    const game = await test.prisma.game.findUniqueOrThrow({
      where: { id: gameId },
    });
    expect(game.publisher).toBe('Hand Edited');
    expect(game.releaseYear).toBe(2001);
    expect(game.genre).toBe('Shooter');
    expect(body.game.userEditedFields).toEqual(['publisher']);
  });

  it('replaces the cached cover when the candidate provides a different one', async () => {
    const { gameId } = await seedGameWith({ coverUrl: null });
    resolver.resolve.mockResolvedValue(matched({ coverUrl: COVER_URL_A }));
    coverHttp.get.mockResolvedValue(imageResponse(COVER_BYTES));

    const first = await test.request
      .post(`/games/${String(gameId)}/enrich`)
      .send({ candidate: { source: 'IGDB', externalId: 1036 } });
    expect(first.status).toBe(200);
    let game = await test.prisma.game.findUniqueOrThrow({
      where: { id: gameId },
    });
    expect(game.coverUrl).toBe(servedCover(COVER_URL_A));

    resolver.resolve.mockResolvedValue(matched({ coverUrl: COVER_URL_B }));
    const second = await test.request
      .post(`/games/${String(gameId)}/enrich`)
      .send({ candidate: { source: 'IGDB', externalId: 1036 } });
    expect(second.status).toBe(200);

    game = await test.prisma.game.findUniqueOrThrow({ where: { id: gameId } });
    expect(game.coverUrl).toBe(servedCover(COVER_URL_B));
    expect(game.coverUrl).not.toBe(servedCover(COVER_URL_A));
    expect(coverHttp.get).toHaveBeenCalledWith(COVER_URL_A);
    expect(coverHttp.get).toHaveBeenCalledWith(COVER_URL_B);
  });

  it('clears platformUnverified when the platform is fixed via PATCH', async () => {
    const { platformId, gameId } = await seedGameWith({
      platformUnverified: true,
    });

    const res = await test.request
      .patch(`/games/${String(gameId)}`)
      .send({ platformId });

    expect(res.status).toBe(200);
    const game = await test.prisma.game.findUniqueOrThrow({
      where: { id: gameId },
    });
    expect(game.platformUnverified).toBe(false);
  });

  it('clears platformUnverified on a successful re-enrichment', async () => {
    const { gameId } = await seedGameWith({ platformUnverified: true });
    resolver.resolve.mockResolvedValue(matched());
    coverHttp.get.mockResolvedValue(imageResponse(COVER_BYTES));

    const res = await test.request
      .post(`/games/${String(gameId)}/enrich`)
      .send({ candidate: { source: 'IGDB', externalId: 1036 } });

    expect(res.status).toBe(200);
    const game = await test.prisma.game.findUniqueOrThrow({
      where: { id: gameId },
    });
    expect(game.platformUnverified).toBe(false);
  });

  it('links a previously unlinked MANUAL game', async () => {
    const { gameId } = await seedGameWith({
      source: 'MANUAL',
      externalId: null,
    });
    resolver.resolve.mockResolvedValue(matched());
    coverHttp.get.mockResolvedValue(imageResponse(COVER_BYTES));

    const res = await test.request
      .post(`/games/${String(gameId)}/enrich`)
      .send({ candidate: { source: 'IGDB', externalId: 1036 } });
    expect(res.status).toBe(200);

    const game = await test.prisma.game.findUniqueOrThrow({
      where: { id: gameId },
    });
    expect(game.source).toBe('IGDB');
    expect(game.externalId).toBe(1036);

    const detail = await test.request.get(`/games/${String(gameId)}`);
    const detailBody = detail.body as GameDetailBody;
    expect(detailBody.externalId).toBe(1036);
    expect(detailBody.source).toBe('IGDB');
  });

  it('is idempotent: applying the same candidate twice writes once', async () => {
    const { gameId } = await seedGameWith();
    resolver.resolve.mockResolvedValue(matched());
    coverHttp.get.mockResolvedValue(imageResponse(COVER_BYTES));
    const body = { candidate: { source: 'IGDB', externalId: 1036 } };

    const first = await test.request
      .post(`/games/${String(gameId)}/enrich`)
      .send(body);
    expect((first.body as EnrichBody).applied).toBe(true);
    const afterFirst = await test.prisma.game.findUniqueOrThrow({
      where: { id: gameId },
    });

    const second = await test.request
      .post(`/games/${String(gameId)}/enrich`)
      .send(body);
    expect(second.status).toBe(200);
    expect((second.body as EnrichBody).applied).toBe(false);

    const afterSecond = await test.prisma.game.findUniqueOrThrow({
      where: { id: gameId },
    });
    // Byte-identical: no second write, so updatedAt/enrichedAt are unchanged.
    expect(afterSecond).toEqual(afterFirst);
  });

  describe('errors', () => {
    it('404 for an unknown game', async () => {
      const res = await test.request.post('/games/999999/enrich').send({});
      expect(res.status).toBe(404);
    });

    it('400 for an unknown body field or a malformed candidate', async () => {
      const { gameId } = await seedGameWith();

      const unknownField = await test.request
        .post(`/games/${String(gameId)}/enrich`)
        .send({ bogus: true });
      expect(unknownField.status).toBe(400);

      const missingExternalId = await test.request
        .post(`/games/${String(gameId)}/enrich`)
        .send({ candidate: { source: 'IGDB' } });
      expect(missingExternalId.status).toBe(400);
    });

    it('400 for an invalid candidate source', async () => {
      const { gameId } = await seedGameWith();
      const res = await test.request
        .post(`/games/${String(gameId)}/enrich`)
        .send({ candidate: { source: 'Bogus', externalId: 1 } });
      expect(res.status).toBe(400);
    });

    it('503 when the catalog lookup is transient', async () => {
      const { gameId } = await seedGameWith();
      resolver.resolve.mockResolvedValue({
        kind: 'transient',
        reason: 'IGDB rate-limited the request',
      });

      const res = await test.request
        .post(`/games/${String(gameId)}/enrich`)
        .send({});
      expect(res.status).toBe(503);
      const game = await test.prisma.game.findUniqueOrThrow({
        where: { id: gameId },
      });
      expect(game.enrichedAt).toBeNull();
    });

    it('409 when the picked candidate no longer matches the re-resolved one', async () => {
      const { gameId } = await seedGameWith();
      resolver.resolve.mockResolvedValue(matched());

      const res = await test.request
        .post(`/games/${String(gameId)}/enrich`)
        .send({ candidate: { source: 'IGDB', externalId: 999 } });
      expect(res.status).toBe(409);
      expect(
        (await test.prisma.game.findUniqueOrThrow({ where: { id: gameId } }))
          .externalId,
      ).toBeNull();
    });

    it('401 for an unauthenticated request', async () => {
      const { gameId } = await seedGameWith();
      const anon = await supertest(app.getHttpServer() as Server)
        .post(`/games/${String(gameId)}/enrich`)
        .send({});
      expect(anon.status).toBe(401);
    });
  });
});
