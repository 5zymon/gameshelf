import type { INestApplication } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import supertest from 'supertest';
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
const GALLERY_ART = 'https://images.igdb.com/igdb/image/upload/t_1080p/art.jpg';
const GALLERY_SHOT =
  'https://images.igdb.com/igdb/image/upload/t_1080p/shot.jpg';
const GALLERY_NEW = 'https://images.igdb.com/igdb/image/upload/t_1080p/new.jpg';

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

interface GameVideoBody {
  id: number;
  name: string | null;
  videoId: string;
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
  summary: string | null;
  rating: number | null;
  ratingCount: number | null;
  coverUrl: string | null;
  videos: GameVideoBody[];
  rawMetadata: string | null;
  enrichedAt: string | null;
  source: string;
  externalId: number | null;
  igdbUrl: string | null;
  platformUnverified: boolean;
  userEditedFields: string[];
  images: { url: string; thumbUrl: string | null }[];
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

/** The same-origin thumbnail path for a served image URL. */
function servedThumb(servedUrl: string): string {
  return servedUrl.replace('/api/covers/', '/api/covers/thumbs/');
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
    images: [],
    platforms: [{ igdbId: 11, name: 'Xbox', abbreviation: 'XBOX' }],
    source: 'IGDB',
    slug: 'halo-combat-evolved',
    raw: { id: 1036 },
    ...overrides,
  };
}

/** A `CatalogSearchResult` carrying the given ranked candidates, best first. */
function searchMatches(...candidates: CatalogCandidate[]): CatalogSearchResult {
  return { kind: 'matches', candidates };
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
  igdbSlug?: string | null;
  platformUnverified?: boolean;
  userEditedFields?: string | null;
}

describe('Game re-enrichment (e2e)', () => {
  let test: TestApp;
  let app: INestApplication;
  let coversDir: string;
  let resolver: { search: jest.Mock };
  let coverHttp: { get: jest.Mock<Promise<CoverHttpResponse>, [string]> };

  beforeAll(async () => {
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
    resolver.search.mockResolvedValue(searchMatches(candidate()));
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
    // The candidate cover is a same-origin signed preview, never the external
    // host.
    expect(searchBody.candidates[0]?.coverUrl).toMatch(
      /^\/api\/covers\/preview\?u=/,
    );
    expect(searchBody.candidates[0]?.coverUrl).not.toContain('images.igdb.com');
    // The archival raw payload and the internal IGDB slug are never exposed.
    expect(searchBody.candidates[0]?.raw).toBeUndefined();
    expect(searchBody.candidates[0]).not.toHaveProperty('slug');

    // Search against the current (corrected) title, no mutation.
    expect(resolver.search).toHaveBeenCalledWith('Halo');
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
    expect(game.sourceCoverUrl).toBe(COVER_URL_A);
    expect(game.source).toBe('IGDB');
    expect(game.externalId).toBe(1036);
    expect(game.enrichedAt).not.toBeNull();
    expect(JSON.parse(game.rawMetadata ?? '')).toEqual({ id: 1036 });

    // The response reflects the protected fields too.
    expect(applyBody.game.title).toBe('Halo');
    expect(applyBody.game.platformId).toBe(platformId);
    expect(applyBody.game.edition).toBe('Standard');
    expect(applyBody.game.externalId).toBe(1036);
    // The internal external-cover link is never serialized.
    expect(applyBody.game).not.toHaveProperty('sourceCoverUrl');
  });

  it('returns the ranked candidate list (multiple) on search', async () => {
    const { gameId } = await seedGameWith({ title: 'Halo' });
    resolver.search.mockResolvedValue(
      searchMatches(
        candidate({ externalId: 1036 }),
        candidate({ externalId: 2002, title: 'Halo 2' }),
      ),
    );

    const res = await test.request
      .post(`/games/${String(gameId)}/enrich`)
      .send({});
    expect(res.status).toBe(200);
    const body = res.body as EnrichBody;
    expect(body.status).toBe('matched');
    expect(body.applied).toBe(false);
    // Order is preserved, best match first.
    expect(body.candidates.map((c) => c.externalId)).toEqual([1036, 2002]);
    expect(body.candidates[1]?.title).toBe('Halo 2');
    // Each candidate's cover is a same-origin signed preview, never the
    // external host, and the archival raw payload and internal IGDB slug are
    // never exposed.
    for (const entry of body.candidates) {
      expect(entry.coverUrl).toMatch(/^\/api\/covers\/preview\?u=/);
      expect(entry.coverUrl).not.toContain('images.igdb.com');
      expect(entry.raw).toBeUndefined();
      expect(entry).not.toHaveProperty('slug');
    }
    // Search mutates nothing.
    expect(
      (await test.prisma.game.findUniqueOrThrow({ where: { id: gameId } }))
        .externalId,
    ).toBeNull();
  });

  it('maps a candidate with no cover to a null cover in a multi-item list', async () => {
    const { gameId } = await seedGameWith({ title: 'Halo' });
    resolver.search.mockResolvedValue(
      searchMatches(
        candidate({ externalId: 1036 }),
        candidate({ externalId: 2002, title: 'Halo 2', coverUrl: null }),
      ),
    );

    const res = await test.request
      .post(`/games/${String(gameId)}/enrich`)
      .send({});
    expect(res.status).toBe(200);
    const body = res.body as EnrichBody;
    expect(body.candidates).toHaveLength(2);
    expect(body.candidates[0]?.coverUrl).toMatch(/^\/api\/covers\/preview\?u=/);
    // A candidate without a cover maps to null (previewUrl(null) → null), never
    // a throw or a malformed preview URL.
    expect(body.candidates[1]?.coverUrl).toBeNull();
  });

  it('applies a non-first candidate without touching identity fields', async () => {
    const { platformId, gameId } = await seedGameWith({
      title: 'Halo',
      edition: 'Standard',
    });
    resolver.search.mockResolvedValue(
      searchMatches(
        candidate({ externalId: 1036 }),
        candidate({ externalId: 2002, title: 'Halo 2', coverUrl: COVER_URL_B }),
      ),
    );
    coverHttp.get.mockResolvedValue(imageResponse(COVER_BYTES));

    const res = await test.request
      .post(`/games/${String(gameId)}/enrich`)
      .send({ candidate: { source: 'IGDB', externalId: 2002 } });
    expect(res.status).toBe(200);
    const body = res.body as EnrichBody;
    expect(body.applied).toBe(true);

    const game = await test.prisma.game.findUniqueOrThrow({
      where: { id: gameId },
    });
    expect(game.externalId).toBe(2002);
    expect(game.source).toBe('IGDB');
    // Identity fields stay protected.
    expect(game.title).toBe('Halo');
    expect(game.platformId).toBe(platformId);
    expect(game.edition).toBe('Standard');
  });

  it('reports still-unresolved without destroying existing metadata', async () => {
    const { gameId } = await seedGameWith({
      releaseYear: 1999,
      publisher: 'Original',
      genre: 'Action',
      playerCount: 4,
      coverUrl: OLD_COVER,
    });
    resolver.search.mockResolvedValue(searchMatches());

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

  it('reports unrecognized (200) for an apply when the fresh list is empty', async () => {
    const { gameId } = await seedGameWith({
      releaseYear: 1999,
      publisher: 'Original',
    });
    resolver.search.mockResolvedValue(searchMatches());

    const res = await test.request
      .post(`/games/${String(gameId)}/enrich`)
      .send({ candidate: { source: 'IGDB', externalId: 1036 } });
    expect(res.status).toBe(200);
    const body = res.body as EnrichBody;
    expect(body.status).toBe('unrecognized');
    expect(body.reason).toBe('No game matched the title in any source');
    expect(body.candidates).toEqual([]);
    expect(body.applied).toBe(false);

    // The empty fresh list means nothing is available to apply — no write.
    const game = await test.prisma.game.findUniqueOrThrow({
      where: { id: gameId },
    });
    expect(game.releaseYear).toBe(1999);
    expect(game.publisher).toBe('Original');
    expect(game.externalId).toBeNull();
    expect(game.enrichedAt).toBeNull();
  });

  it('leaves a hand-edited publisher intact while filling the rest', async () => {
    const { gameId } = await seedGameWith({
      publisher: 'Hand Edited',
      userEditedFields: '["publisher"]',
    });
    resolver.search.mockResolvedValue(searchMatches(candidate()));
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
    resolver.search.mockResolvedValue(
      searchMatches(candidate({ coverUrl: COVER_URL_A })),
    );
    coverHttp.get.mockResolvedValue(imageResponse(COVER_BYTES));

    const first = await test.request
      .post(`/games/${String(gameId)}/enrich`)
      .send({ candidate: { source: 'IGDB', externalId: 1036 } });
    expect(first.status).toBe(200);
    let game = await test.prisma.game.findUniqueOrThrow({
      where: { id: gameId },
    });
    expect(game.coverUrl).toBe(servedCover(COVER_URL_A));

    resolver.search.mockResolvedValue(
      searchMatches(candidate({ coverUrl: COVER_URL_B })),
    );
    const second = await test.request
      .post(`/games/${String(gameId)}/enrich`)
      .send({ candidate: { source: 'IGDB', externalId: 1036 } });
    expect(second.status).toBe(200);

    game = await test.prisma.game.findUniqueOrThrow({ where: { id: gameId } });
    expect(game.coverUrl).toBe(servedCover(COVER_URL_B));
    expect(game.coverUrl).not.toBe(servedCover(COVER_URL_A));
    expect(game.sourceCoverUrl).toBe(COVER_URL_B);
    expect(coverHttp.get).toHaveBeenCalledWith(COVER_URL_A);
    expect(coverHttp.get).toHaveBeenCalledWith(COVER_URL_B);
    // The replaced file is removed (ref-counted), the new one is present.
    const cache = app.get(CoverCacheService);
    const fileA = servedCover(COVER_URL_A).split('/').pop() ?? '';
    const fileB = servedCover(COVER_URL_B).split('/').pop() ?? '';
    await expect(cache.has(fileA)).resolves.toBe(false);
    await expect(cache.has(fileB)).resolves.toBe(true);
  });

  it('keeps the existing cover when a re-enrichment download fails', async () => {
    const { gameId } = await seedGameWith({ coverUrl: OLD_COVER });
    resolver.search.mockResolvedValue(
      searchMatches(candidate({ coverUrl: COVER_URL_A })),
    );
    coverHttp.get.mockRejectedValue(new Error('network down'));

    const res = await test.request
      .post(`/games/${String(gameId)}/enrich`)
      .send({ candidate: { source: 'IGDB', externalId: 1036 } });
    expect(res.status).toBe(200);

    const game = await test.prisma.game.findUniqueOrThrow({
      where: { id: gameId },
    });
    // The failed download never clobbers the existing cover; the source link is
    // recorded so a retry can fetch the new one later.
    expect(game.coverUrl).toBe(OLD_COVER);
    expect(game.sourceCoverUrl).toBe(COVER_URL_A);
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
    resolver.search.mockResolvedValue(searchMatches(candidate()));
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
    resolver.search.mockResolvedValue(searchMatches(candidate()));
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

  it('stores the IGDB slug on apply and exposes the IGDB page without the slug', async () => {
    const { gameId } = await seedGameWith({
      source: 'MANUAL',
      externalId: null,
    });
    resolver.search.mockResolvedValue(searchMatches(candidate()));
    coverHttp.get.mockResolvedValue(imageResponse(COVER_BYTES));

    const res = await test.request
      .post(`/games/${String(gameId)}/enrich`)
      .send({ candidate: { source: 'IGDB', externalId: 1036 } });
    expect(res.status).toBe(200);

    const game = await test.prisma.game.findUniqueOrThrow({
      where: { id: gameId },
    });
    expect(game.igdbSlug).toBe('halo-combat-evolved');

    const detail = await test.request.get(`/games/${String(gameId)}`);
    const detailBody = detail.body as GameDetailBody;
    expect(detailBody.igdbUrl).toBe(
      'https://www.igdb.com/games/halo-combat-evolved',
    );
    expect(detailBody).not.toHaveProperty('igdbSlug');
  });

  it('shows no IGDB link for a game enriched before slugs were stored, until re-enriched', async () => {
    const { gameId } = await seedGameWith({
      source: 'IGDB',
      externalId: 1036,
      igdbSlug: null,
    });

    const detail = await test.request.get(`/games/${String(gameId)}`);
    expect((detail.body as GameDetailBody).igdbUrl).toBeNull();
    // Viewing the page never reaches out to IGDB to backfill a slug.
    expect(resolver.search).not.toHaveBeenCalled();
  });

  it('is idempotent: applying the same candidate twice writes once', async () => {
    const { gameId } = await seedGameWith();
    resolver.search.mockResolvedValue(searchMatches(candidate()));
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

  it('caches and persists the candidate gallery on apply', async () => {
    const { gameId } = await seedGameWith();
    resolver.search.mockResolvedValue(
      searchMatches(candidate({ images: [GALLERY_ART, GALLERY_SHOT] })),
    );
    coverHttp.get.mockResolvedValue(imageResponse(COVER_BYTES));

    const res = await test.request
      .post(`/games/${String(gameId)}/enrich`)
      .send({ candidate: { source: 'IGDB', externalId: 1036 } });
    expect(res.status).toBe(200);

    const images = await test.prisma.gameImage.findMany({
      where: { gameId },
      orderBy: { position: 'asc' },
    });
    expect(images.map((image) => image.url)).toEqual([
      servedCover(GALLERY_ART),
      servedCover(GALLERY_SHOT),
    ]);
    expect(images.map((image) => image.sourceUrl)).toEqual([
      GALLERY_ART,
      GALLERY_SHOT,
    ]);

    const cache = app.get(CoverCacheService);
    for (const url of [GALLERY_ART, GALLERY_SHOT]) {
      const file = servedCover(url).split('/').pop() ?? '';
      await expect(cache.has(file)).resolves.toBe(true);
    }

    // The detail response exposes the ordered gallery, same-origin only.
    const detail = await test.request.get(`/games/${String(gameId)}`);
    const detailBody = detail.body as GameDetailBody;
    expect(detailBody.images).toEqual([
      {
        url: servedCover(GALLERY_ART),
        thumbUrl: servedThumb(servedCover(GALLERY_ART)),
      },
      {
        url: servedCover(GALLERY_SHOT),
        thumbUrl: servedThumb(servedCover(GALLERY_SHOT)),
      },
    ]);
    expect(JSON.stringify(detailBody.images)).not.toContain('images.igdb.com');
    expect(detailBody).not.toHaveProperty('sourceCoverUrl');
  });

  it('replaces the gallery and removes dropped files on re-apply', async () => {
    const { gameId } = await seedGameWith();
    resolver.search.mockResolvedValue(
      searchMatches(candidate({ images: [GALLERY_ART, GALLERY_SHOT] })),
    );
    coverHttp.get.mockResolvedValue(imageResponse(COVER_BYTES));
    await test.request
      .post(`/games/${String(gameId)}/enrich`)
      .send({ candidate: { source: 'IGDB', externalId: 1036 } });

    resolver.search.mockResolvedValue(
      searchMatches(candidate({ images: [GALLERY_NEW] })),
    );
    const res = await test.request
      .post(`/games/${String(gameId)}/enrich`)
      .send({ candidate: { source: 'IGDB', externalId: 1036 } });
    expect(res.status).toBe(200);

    const images = await test.prisma.gameImage.findMany({ where: { gameId } });
    expect(images.map((image) => image.url)).toEqual([
      servedCover(GALLERY_NEW),
    ]);

    const cache = app.get(CoverCacheService);
    for (const url of [GALLERY_ART, GALLERY_SHOT]) {
      const file = servedCover(url).split('/').pop() ?? '';
      await expect(cache.has(file)).resolves.toBe(false);
    }
    const newFile = servedCover(GALLERY_NEW).split('/').pop() ?? '';
    await expect(cache.has(newFile)).resolves.toBe(true);
  });

  it('keeps the existing gallery when the candidate supplies none', async () => {
    const { gameId } = await seedGameWith();
    resolver.search.mockResolvedValue(
      searchMatches(candidate({ images: [GALLERY_ART] })),
    );
    coverHttp.get.mockResolvedValue(imageResponse(COVER_BYTES));
    await test.request
      .post(`/games/${String(gameId)}/enrich`)
      .send({ candidate: { source: 'IGDB', externalId: 1036 } });

    resolver.search.mockResolvedValue(searchMatches(candidate({ images: [] })));
    const res = await test.request
      .post(`/games/${String(gameId)}/enrich`)
      .send({ candidate: { source: 'IGDB', externalId: 1036 } });
    expect(res.status).toBe(200);
    expect((res.body as EnrichBody).applied).toBe(false);

    const images = await test.prisma.gameImage.findMany({ where: { gameId } });
    expect(images.map((image) => image.url)).toEqual([
      servedCover(GALLERY_ART),
    ]);
    const file = servedCover(GALLERY_ART).split('/').pop() ?? '';
    await expect(app.get(CoverCacheService).has(file)).resolves.toBe(true);
  });

  it('applies summary, rating and videos from a re-enrichment candidate', async () => {
    const { gameId } = await seedGameWith();
    resolver.search.mockResolvedValue(
      searchMatches(
        candidate({
          summary: 'IGDB text',
          rating: 90,
          ratingCount: 42,
          videos: [{ videoId: 'AbCdEfGhIj0', name: 'Trailer' }],
        }),
      ),
    );
    coverHttp.get.mockResolvedValue(imageResponse(COVER_BYTES));

    const res = await test.request
      .post(`/games/${String(gameId)}/enrich`)
      .send({ candidate: { source: 'IGDB', externalId: 1036 } });
    expect(res.status).toBe(200);
    expect((res.body as EnrichBody).applied).toBe(true);

    const detail = await test.request.get(`/games/${String(gameId)}`);
    const detailBody = detail.body as GameDetailBody;
    expect(detailBody.summary).toBe('IGDB text');
    expect(detailBody.rating).toBe(90);
    expect(detailBody.ratingCount).toBe(42);
    expect(detailBody.videos[0]?.videoId).toBe('AbCdEfGhIj0');
    expect(detailBody.videos[0]?.name).toBe('Trailer');
  });

  it('keeps a hand-edited summary while refreshing the rating', async () => {
    const { gameId } = await seedGameWith({
      source: 'IGDB',
      externalId: 1036,
    });

    const patch = await test.request
      .patch(`/games/${String(gameId)}`)
      .send({ summary: 'Mine' });
    expect(patch.status).toBe(200);

    resolver.search.mockResolvedValue(
      searchMatches(candidate({ summary: 'IGDB text', rating: 90 })),
    );
    coverHttp.get.mockResolvedValue(imageResponse(COVER_BYTES));

    const res = await test.request
      .post(`/games/${String(gameId)}/enrich`)
      .send({ candidate: { source: 'IGDB', externalId: 1036 } });
    expect(res.status).toBe(200);
    expect((res.body as EnrichBody).applied).toBe(true);

    const game = await test.prisma.game.findUniqueOrThrow({
      where: { id: gameId },
    });
    expect(game.summary).toBe('Mine');
    expect(game.rating).toBe(90);

    const detail = await test.request.get(`/games/${String(gameId)}`);
    const detailBody = detail.body as GameDetailBody;
    expect(detailBody.userEditedFields).toContain('summary');
    expect(detailBody.summary).toBe('Mine');
    expect(detailBody.rating).toBe(90);
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
      resolver.search.mockResolvedValue({
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
      resolver.search.mockResolvedValue(searchMatches(candidate()));

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
