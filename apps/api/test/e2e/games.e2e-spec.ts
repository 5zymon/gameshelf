import { createHash } from 'node:crypto';
import {
  CoverHttpClient,
  type CoverHttpResponse,
} from '../../src/covers/cover-http.client';
import { createTestApp, type TestApp } from '../helpers/test-app';
import { resetDatabase } from '../helpers/reset';
import { seedGame, seedPlatform } from '../helpers/seed';

/** A same-origin cover path the API would store for an external URL. */
function servedCover(url: string): string {
  const hash = createHash('sha256').update(url).digest('hex').slice(0, 32);
  return `/api/covers/${hash}.jpg`;
}

const EXTERNAL_COVER =
  'https://images.igdb.com/igdb/image/upload/t_thumb/hk.jpg';

interface PlatformRef {
  id: number;
  name: string;
  slug: string;
}

interface GameListItem {
  id: number;
  title: string;
  edition: string | null;
  coverUrl: string | null;
  coverThumbUrl: string | null;
  platform: PlatformRef;
}

interface GameDetail extends GameListItem {
  platformId: number;
  releaseYear: number | null;
  publisher: string | null;
  genre: string | null;
  playerCount: number | null;
  rawMetadata: string | null;
  enrichedAt: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
}

interface GamesListBody {
  items: GameListItem[];
  meta: { page: number; limit: number; total: number; totalPages: number };
  filters: { platforms: PlatformRef[]; editions: string[] };
}

describe('Games API (e2e)', () => {
  let test: TestApp;
  let coverHttp: { get: jest.Mock<Promise<CoverHttpResponse>, [string]> };

  beforeAll(async () => {
    coverHttp = { get: jest.fn<Promise<CoverHttpResponse>, [string]>() };
    test = await createTestApp([
      { provide: CoverHttpClient, useValue: coverHttp },
    ]);
  });

  beforeEach(async () => {
    await resetDatabase(test.prisma);
    coverHttp.get.mockReset();
    await test.login();
  });

  afterAll(async () => {
    await test.app.close();
  });

  describe('GET /games', () => {
    it('returns an empty page with empty filter metadata', async () => {
      const res = await test.request.get('/games');

      expect(res.status).toBe(200);
      expect(res.body as GamesListBody).toEqual({
        items: [],
        meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
        filters: { platforms: [], editions: [] },
      });
    });

    it('paginates with id-asc order by default', async () => {
      const p = await seedPlatform(test.prisma, { name: 'PC', slug: 'pc' });
      // Sequential seeding: parallel inserts would make the auto-increment
      // ids land out of array order.
      const games = [];
      for (let i = 1; i <= 5; i += 1) {
        games.push(
          await seedGame(test.prisma, {
            title: `Game ${String(i)}`,
            platformId: p.id,
          }),
        );
      }

      const page1 = (await test.request.get('/games?limit=2&page=1'))
        .body as GamesListBody;
      expect(page1.items.map((g) => g.id)).toEqual([
        games[0]?.id,
        games[1]?.id,
      ]);
      expect(page1.meta).toEqual({
        page: 1,
        limit: 2,
        total: 5,
        totalPages: 3,
      });

      const page3 = (await test.request.get('/games?limit=2&page=3'))
        .body as GamesListBody;
      expect(page3.items).toHaveLength(1);
      expect(page3.items[0]?.id).toBe(games[4]?.id);
    });

    it('filters by platformId, edition, year, publisher, genre and playerCount', async () => {
      const pc = await seedPlatform(test.prisma, { name: 'PC', slug: 'pc' });
      const ps5 = await seedPlatform(test.prisma, {
        name: 'PlayStation 5',
        slug: 'ps5',
      });
      await seedGame(test.prisma, {
        title: 'Match',
        platformId: pc.id,
        edition: 'GOTY',
        releaseYear: 2017,
        publisher: 'Team Cherry',
        genre: 'Metroidvania',
        playerCount: 1,
      });
      await seedGame(test.prisma, { title: 'Other', platformId: ps5.id });

      const byPlatform = (
        await test.request.get('/games').query({ platformId: pc.id })
      ).body as GamesListBody;
      expect(byPlatform.items.map((g) => g.title)).toEqual(['Match']);

      const byEdition = (
        await test.request.get('/games').query({ edition: 'GOTY' })
      ).body as GamesListBody;
      expect(byEdition.items.map((g) => g.title)).toEqual(['Match']);

      const byYear = (await test.request.get('/games').query({ year: 2017 }))
        .body as GamesListBody;
      expect(byYear.items.map((g) => g.title)).toEqual(['Match']);

      const byPublisher = (
        await test.request.get('/games').query({ publisher: 'Team Cherry' })
      ).body as GamesListBody;
      expect(byPublisher.items.map((g) => g.title)).toEqual(['Match']);

      const byGenre = (
        await test.request.get('/games').query({ genre: 'Metroidvania' })
      ).body as GamesListBody;
      expect(byGenre.items.map((g) => g.title)).toEqual(['Match']);

      const byPlayerCount = (
        await test.request.get('/games').query({ playerCount: 1 })
      ).body as GamesListBody;
      expect(byPlayerCount.items.map((g) => g.title)).toEqual(['Match']);

      const noMatch = (await test.request.get('/games').query({ year: 1999 }))
        .body as GamesListBody;
      expect(noMatch.items).toEqual([]);
      expect(noMatch.meta.total).toBe(0);
    });

    it('searches titles case-insensitively (q)', async () => {
      const p = await seedPlatform(test.prisma, { name: 'PC', slug: 'pc' });
      await seedGame(test.prisma, { title: 'Hollow Knight', platformId: p.id });
      await seedGame(test.prisma, { title: 'Celeste', platformId: p.id });

      const lower = (await test.request.get('/games').query({ q: 'hollow' }))
        .body as GamesListBody;
      expect(lower.items.map((g) => g.title)).toEqual(['Hollow Knight']);

      const upper = (await test.request.get('/games').query({ q: 'KNIGHT' }))
        .body as GamesListBody;
      expect(upper.items.map((g) => g.title)).toEqual(['Hollow Knight']);
    });

    it('escapes LIKE wildcards in q', async () => {
      const p = await seedPlatform(test.prisma, { name: 'PC', slug: 'pc' });
      await seedGame(test.prisma, { title: '100% Off', platformId: p.id });
      await seedGame(test.prisma, { title: '100x Off', platformId: p.id });
      await seedGame(test.prisma, { title: 'a_b', platformId: p.id });
      await seedGame(test.prisma, { title: 'axb', platformId: p.id });

      const percent = (await test.request.get('/games').query({ q: '100%' }))
        .body as GamesListBody;
      expect(percent.items.map((g) => g.title)).toEqual(['100% Off']);

      const underscore = (await test.request.get('/games').query({ q: 'a_b' }))
        .body as GamesListBody;
      expect(underscore.items.map((g) => g.title)).toEqual(['a_b']);
    });

    it('combines filters with AND', async () => {
      const pc = await seedPlatform(test.prisma, { name: 'PC', slug: 'pc' });
      const ps5 = await seedPlatform(test.prisma, {
        name: 'PlayStation 5',
        slug: 'ps5',
      });
      await seedGame(test.prisma, {
        title: 'Hollow Knight',
        platformId: pc.id,
        releaseYear: 2017,
      });
      await seedGame(test.prisma, {
        title: 'Hollow Knight',
        platformId: ps5.id,
        releaseYear: 2017,
      });
      await seedGame(test.prisma, {
        title: 'Hollow Knight',
        platformId: pc.id,
        releaseYear: 2019,
      });

      const res = (
        await test.request
          .get('/games')
          .query({ q: 'hollow', platformId: pc.id, year: 2017 })
      ).body as GamesListBody;
      expect(res.meta.total).toBe(1);
      expect(res.items[0]?.platform.id).toBe(pc.id);
    });

    it('sorts by title deterministically', async () => {
      const p = await seedPlatform(test.prisma, { name: 'PC', slug: 'pc' });
      const alpha = await seedGame(test.prisma, {
        title: 'Alpha',
        platformId: p.id,
      });
      const beta = await seedGame(test.prisma, {
        title: 'Beta',
        platformId: p.id,
      });
      const gamma = await seedGame(test.prisma, {
        title: 'Gamma',
        platformId: p.id,
      });

      const asc = (await test.request.get('/games').query({ sort: 'title' }))
        .body as GamesListBody;
      expect(asc.items.map((g) => g.id)).toEqual([alpha.id, beta.id, gamma.id]);

      const desc = (
        await test.request.get('/games').query({ sort: 'title', order: 'desc' })
      ).body as GamesListBody;
      expect(desc.items.map((g) => g.id)).toEqual([
        gamma.id,
        beta.id,
        alpha.id,
      ]);
    });

    it('sorts by year with unknown years last (both directions)', async () => {
      const p = await seedPlatform(test.prisma, { name: 'PC', slug: 'pc' });
      const recent = await seedGame(test.prisma, {
        title: 'Recent',
        platformId: p.id,
        releaseYear: 2017,
      });
      const old = await seedGame(test.prisma, {
        title: 'Old',
        platformId: p.id,
        releaseYear: 1999,
      });
      const unknown = await seedGame(test.prisma, {
        title: 'Unknown',
        platformId: p.id,
      });

      const asc = (await test.request.get('/games').query({ sort: 'year' }))
        .body as GamesListBody;
      expect(asc.items.map((g) => g.id)).toEqual([
        old.id,
        recent.id,
        unknown.id,
      ]);

      const desc = (
        await test.request.get('/games').query({ sort: 'year', order: 'desc' })
      ).body as GamesListBody;
      expect(desc.items.map((g) => g.id)).toEqual([
        recent.id,
        old.id,
        unknown.id,
      ]);
    });

    it('returns filter metadata: platforms with games and distinct editions', async () => {
      const pc = await seedPlatform(test.prisma, { name: 'PC', slug: 'pc' });
      // A second platform without games — it must not appear in the metadata.
      await seedPlatform(test.prisma, { name: 'PlayStation 5', slug: 'ps5' });
      await seedGame(test.prisma, {
        title: 'A',
        platformId: pc.id,
        edition: 'GOTY',
      });
      await seedGame(test.prisma, {
        title: 'B',
        platformId: pc.id,
        edition: 'Standard',
      });
      await seedGame(test.prisma, {
        title: 'C',
        platformId: pc.id,
        edition: 'GOTY',
      });

      const res = (await test.request.get('/games')).body as GamesListBody;

      expect(res.filters.platforms).toEqual([
        { id: pc.id, name: 'PC', slug: 'pc' },
      ]);
      expect(res.filters.editions).toEqual(['GOTY', 'Standard']);
    });

    it.each([
      'page=0',
      'page=-1',
      'page=abc',
      'limit=0',
      'limit=101',
      'limit=abc',
      'platformId=0',
      'year=999',
      'year=2101',
      'year=abc',
      'playerCount=0',
      'playerCount=101',
      'sort=bogus',
      'order=bogus',
      'bogus=1',
      `q=${'a'.repeat(256)}`,
      `edition=${'a'.repeat(256)}`,
      `publisher=${'a'.repeat(256)}`,
      `genre=${'a'.repeat(256)}`,
    ])('rejects %s with 400', async (query) => {
      const res = await test.request.get(`/games?${query}`);

      expect(res.status).toBe(400);
    });
  });

  describe('GET /games/:id', () => {
    it('returns the full record with its platform projection', async () => {
      const p = await seedPlatform(test.prisma, {
        name: 'PlayStation 5',
        slug: 'ps5',
      });
      const game = await seedGame(test.prisma, {
        title: 'Hollow Knight',
        platformId: p.id,
        edition: 'GOTY',
        releaseYear: 2017,
        publisher: 'Team Cherry',
        genre: 'Metroidvania',
        playerCount: 1,
        coverUrl: servedCover(EXTERNAL_COVER),
      });

      const res = await test.request.get(`/games/${String(game.id)}`);

      expect(res.status).toBe(200);
      const body = res.body as GameDetail;
      expect(body.id).toBe(game.id);
      expect(body.title).toBe('Hollow Knight');
      expect(body.platformId).toBe(p.id);
      expect(body.edition).toBe('GOTY');
      expect(body.releaseYear).toBe(2017);
      expect(body.publisher).toBe('Team Cherry');
      expect(body.genre).toBe('Metroidvania');
      expect(body.playerCount).toBe(1);
      expect(body.coverUrl).toBe(servedCover(EXTERNAL_COVER));
      expect(body.coverUrl).toMatch(/^\/api\/covers\//);
      // The internal source link is never serialized.
      expect(body).not.toHaveProperty('sourceCoverUrl');
      expect(body.rawMetadata).toBeNull();
      expect(body.enrichedAt).toBeNull();
      expect(body.source).toBe('MANUAL');
      expect(typeof body.createdAt).toBe('string');
      expect(typeof body.updatedAt).toBe('string');
      expect(body.platform).toEqual({
        id: p.id,
        name: 'PlayStation 5',
        slug: 'ps5',
      });
    });

    it('returns 404 for an unknown id', async () => {
      const res = await test.request.get('/games/999999');

      expect(res.status).toBe(404);
    });

    it.each(['abc', '0', '1.5'])('returns 400 for id "%s"', async (id) => {
      const res = await test.request.get(`/games/${id}`);

      expect(res.status).toBe(400);
    });
  });

  describe('POST /games', () => {
    it('creates a minimal game with null defaults and MANUAL source', async () => {
      const p = await seedPlatform(test.prisma, { name: 'PC', slug: 'pc' });

      const res = await test.request
        .post('/games')
        .send({ title: 'Hollow Knight', platformId: p.id });

      expect(res.status).toBe(201);
      const body = res.body as GameDetail;
      expect(body.id).toBeGreaterThan(0);
      expect(body.title).toBe('Hollow Knight');
      expect(body.platformId).toBe(p.id);
      expect(body.edition).toBeNull();
      expect(body.releaseYear).toBeNull();
      expect(body.publisher).toBeNull();
      expect(body.genre).toBeNull();
      expect(body.playerCount).toBeNull();
      expect(body.coverUrl).toBeNull();
      expect(body.rawMetadata).toBeNull();
      expect(body.enrichedAt).toBeNull();
      expect(body.source).toBe('MANUAL');
      expect(body.platform).toEqual({ id: p.id, name: 'PC', slug: 'pc' });
    });

    it('creates a full game with every optional field', async () => {
      const p = await seedPlatform(test.prisma, { name: 'PC', slug: 'pc' });
      const bytes = Buffer.from('fake-cover-bytes');
      coverHttp.get.mockResolvedValue({
        ok: true,
        status: 200,
        contentType: 'image/jpeg',
        body: bytes,
      });

      const res = await test.request.post('/games').send({
        title: 'Hollow Knight',
        platformId: p.id,
        edition: 'GOTY',
        releaseYear: 2017,
        publisher: 'Team Cherry',
        genre: 'Metroidvania',
        playerCount: 1,
        coverUrl: EXTERNAL_COVER,
      });

      expect(res.status).toBe(201);
      const body = res.body as GameDetail;
      expect(body.edition).toBe('GOTY');
      expect(body.releaseYear).toBe(2017);
      expect(body.publisher).toBe('Team Cherry');
      expect(body.genre).toBe('Metroidvania');
      expect(body.playerCount).toBe(1);
      // The external cover is downloaded and served from our own origin.
      expect(coverHttp.get).toHaveBeenCalledWith(EXTERNAL_COVER);
      expect(body.coverUrl).toBe(servedCover(EXTERNAL_COVER));
      expect(body.coverThumbUrl).toBe(
        `/api/covers/thumbs/${servedCover(EXTERNAL_COVER).split('/').pop() ?? ''}`,
      );
      expect(body).not.toHaveProperty('sourceCoverUrl');
    });

    it('saves a placeholder (null cover) when the cover download fails', async () => {
      const p = await seedPlatform(test.prisma, { name: 'PC', slug: 'pc' });
      const failingCover =
        'https://images.igdb.com/igdb/image/upload/t_thumb/missing-cover.jpg';
      coverHttp.get.mockRejectedValue(new Error('network down'));

      const res = await test.request
        .post('/games')
        .send({ title: 'HK', platformId: p.id, coverUrl: failingCover });

      expect(res.status).toBe(201);
      const body = res.body as GameDetail;
      expect(body.coverUrl).toBeNull();
      expect(body).not.toHaveProperty('sourceCoverUrl');
      // The external link is stored internally so the sweep can retry it.
      const row = await test.prisma.game.findFirstOrThrow();
      expect(row.sourceCoverUrl).toBe(failingCover);
    });

    it('rejects a non-allowlisted cover host and stores a placeholder', async () => {
      const p = await seedPlatform(test.prisma, { name: 'PC', slug: 'pc' });
      const evilCover = 'https://evil.example/cover.jpg';
      // The stub would happily serve bytes; the allowlist must prevent the
      // request from ever reaching it.
      coverHttp.get.mockResolvedValue({
        ok: true,
        status: 200,
        contentType: 'image/jpeg',
        body: Buffer.from('should-not-be-fetched'),
      });

      const res = await test.request
        .post('/games')
        .send({ title: 'HK', platformId: p.id, coverUrl: evilCover });

      expect(res.status).toBe(201);
      expect(coverHttp.get).not.toHaveBeenCalled();
      const body = res.body as GameDetail;
      expect(body.coverUrl).toBeNull();
      const row = await test.prisma.game.findFirstOrThrow();
      expect(row.sourceCoverUrl).toBe(evilCover);
    });

    it('rejects an unknown platformId with 400', async () => {
      const res = await test.request
        .post('/games')
        .send({ title: 'Hollow Knight', platformId: 999999 });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        statusCode: 400,
        message: 'Platform with id 999999 does not exist',
        error: 'Bad Request',
      });
    });

    it.each([
      ['missing title and platformId', {}],
      ['empty title', { title: '', platformId: 0 }],
      ['non-string title', { title: 123, platformId: 0 }],
      ['title too long', { title: 'a'.repeat(256), platformId: 0 }],
      ['missing platformId', { title: 'x' }],
      ['platformId below minimum', { title: 'x', platformId: 0 }],
      ['non-integer platformId', { title: 'x', platformId: 'abc' }],
      [
        'releaseYear below minimum',
        { title: 'x', platformId: 0, releaseYear: 999 },
      ],
      [
        'releaseYear above maximum',
        { title: 'x', platformId: 0, releaseYear: 2101 },
      ],
      [
        'non-integer releaseYear',
        { title: 'x', platformId: 0, releaseYear: 'abc' },
      ],
      [
        'playerCount below minimum',
        { title: 'x', platformId: 0, playerCount: 0 },
      ],
      [
        'playerCount above maximum',
        { title: 'x', platformId: 0, playerCount: 101 },
      ],
      [
        'edition too long',
        { title: 'x', platformId: 0, edition: 'a'.repeat(256) },
      ],
      [
        'publisher too long',
        { title: 'x', platformId: 0, publisher: 'a'.repeat(256) },
      ],
      ['genre too long', { title: 'x', platformId: 0, genre: 'a'.repeat(256) }],
      [
        'coverUrl too long',
        { title: 'x', platformId: 0, coverUrl: 'a'.repeat(2084) },
      ],
      ['non-whitelisted field', { title: 'x', platformId: 0, bogus: 1 }],
    ])('rejects %s with 400', async (_name, body) => {
      const res = await test.request.post('/games').send(body);

      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /games/:id', () => {
    it('renames the game', async () => {
      const p = await seedPlatform(test.prisma, { name: 'PC', slug: 'pc' });
      const game = await seedGame(test.prisma, {
        title: 'Old Title',
        platformId: p.id,
      });

      const res = await test.request
        .patch(`/games/${String(game.id)}`)
        .send({ title: 'New Title' });

      expect(res.status).toBe(200);
      const body = res.body as GameDetail;
      expect(body.title).toBe('New Title');
      expect(body.platformId).toBe(p.id);
    });

    it('clears an optional field with an explicit null', async () => {
      const p = await seedPlatform(test.prisma, { name: 'PC', slug: 'pc' });
      const game = await seedGame(test.prisma, {
        title: 'HK',
        platformId: p.id,
        edition: 'GOTY',
        releaseYear: 2017,
      });

      const res = await test.request
        .patch(`/games/${String(game.id)}`)
        .send({ edition: null, releaseYear: null });

      expect(res.status).toBe(200);
      const body = res.body as GameDetail;
      expect(body.edition).toBeNull();
      expect(body.releaseYear).toBeNull();
    });

    it('changes the platform', async () => {
      const pc = await seedPlatform(test.prisma, { name: 'PC', slug: 'pc' });
      const ps5 = await seedPlatform(test.prisma, {
        name: 'PlayStation 5',
        slug: 'ps5',
      });
      const game = await seedGame(test.prisma, {
        title: 'HK',
        platformId: pc.id,
      });

      const res = await test.request
        .patch(`/games/${String(game.id)}`)
        .send({ platformId: ps5.id });

      expect(res.status).toBe(200);
      const body = res.body as GameDetail;
      expect(body.platformId).toBe(ps5.id);
      expect(body.platform).toEqual({
        id: ps5.id,
        name: 'PlayStation 5',
        slug: 'ps5',
      });

      // The per-platform counts follow the reassignment (req 3, §5 Platforms).
      const from = await test.request.get(`/platforms/${String(pc.id)}`);
      expect((from.body as { gameCount: number }).gameCount).toBe(0);
      const to = await test.request.get(`/platforms/${String(ps5.id)}`);
      expect((to.body as { gameCount: number }).gameCount).toBe(1);
    });

    it('downloads and keeps an external cover same-origin on update', async () => {
      const p = await seedPlatform(test.prisma, { name: 'PC', slug: 'pc' });
      const game = await seedGame(test.prisma, {
        title: 'HK',
        platformId: p.id,
      });
      // A URL distinct from the POST fixture: the shared e2e cache dir may
      // already hold that one, which would skip the download.
      const updatedCover =
        'https://images.igdb.com/igdb/image/upload/t_thumb/hk-update.jpg';
      coverHttp.get.mockResolvedValue({
        ok: true,
        status: 200,
        contentType: 'image/jpeg',
        body: Buffer.from('updated-cover-bytes'),
      });

      const res = await test.request
        .patch(`/games/${String(game.id)}`)
        .send({ coverUrl: updatedCover });

      expect(res.status).toBe(200);
      expect(coverHttp.get).toHaveBeenCalledWith(updatedCover);
      const body = res.body as GameDetail;
      expect(body.coverUrl).toBe(servedCover(updatedCover));
      // The external link is internal-only and drives the sweep.
      expect(body).not.toHaveProperty('sourceCoverUrl');
      const row = await test.prisma.game.findUniqueOrThrow({
        where: { id: game.id },
      });
      expect(row.coverUrl).toBe(servedCover(updatedCover));
      expect(row.sourceCoverUrl).toBe(updatedCover);
    });

    it('saves a placeholder on update when the cover download fails', async () => {
      const p = await seedPlatform(test.prisma, { name: 'PC', slug: 'pc' });
      const game = await seedGame(test.prisma, {
        title: 'HK',
        platformId: p.id,
      });
      const failingCover =
        'https://images.igdb.com/igdb/image/upload/t_thumb/missing.jpg';
      coverHttp.get.mockRejectedValue(new Error('network down'));

      const res = await test.request
        .patch(`/games/${String(game.id)}`)
        .send({ coverUrl: failingCover });

      expect(res.status).toBe(200);
      const body = res.body as GameDetail;
      expect(body.coverUrl).toBeNull();
      expect(body).not.toHaveProperty('sourceCoverUrl');
      const row = await test.prisma.game.findUniqueOrThrow({
        where: { id: game.id },
      });
      expect(row.coverUrl).toBeNull();
      expect(row.sourceCoverUrl).toBe(failingCover);
    });

    it('rejects a non-allowlisted cover host on update and saves a placeholder', async () => {
      const p = await seedPlatform(test.prisma, { name: 'PC', slug: 'pc' });
      const game = await seedGame(test.prisma, {
        title: 'HK',
        platformId: p.id,
      });
      coverHttp.get.mockResolvedValue({
        ok: true,
        status: 200,
        contentType: 'image/jpeg',
        body: Buffer.from('should-not-be-fetched'),
      });

      const res = await test.request
        .patch(`/games/${String(game.id)}`)
        .send({ coverUrl: 'https://evil.example/cover.jpg' });

      expect(res.status).toBe(200);
      expect(coverHttp.get).not.toHaveBeenCalled();
      const body = res.body as GameDetail;
      expect(body.coverUrl).toBeNull();
      const row = await test.prisma.game.findUniqueOrThrow({
        where: { id: game.id },
      });
      expect(row.sourceCoverUrl).toBe('https://evil.example/cover.jpg');
    });

    it('preserves the source link when the current local path is re-submitted', async () => {
      const p = await seedPlatform(test.prisma, { name: 'PC', slug: 'pc' });
      const local = servedCover(EXTERNAL_COVER);
      const game = await seedGame(test.prisma, {
        title: 'HK',
        platformId: p.id,
        coverUrl: local,
        sourceCoverUrl: EXTERNAL_COVER,
      });

      const res = await test.request
        .patch(`/games/${String(game.id)}`)
        .send({ coverUrl: local });

      expect(res.status).toBe(200);
      expect(coverHttp.get).not.toHaveBeenCalled();
      const row = await test.prisma.game.findUniqueOrThrow({
        where: { id: game.id },
      });
      expect(row.coverUrl).toBe(local);
      expect(row.sourceCoverUrl).toBe(EXTERNAL_COVER);
    });

    it('is a no-op for an empty body', async () => {
      const p = await seedPlatform(test.prisma, { name: 'PC', slug: 'pc' });
      const game = await seedGame(test.prisma, {
        title: 'HK',
        platformId: p.id,
        edition: 'GOTY',
      });

      const res = await test.request
        .patch(`/games/${String(game.id)}`)
        .send({});

      expect(res.status).toBe(200);
      const body = res.body as GameDetail;
      expect(body.title).toBe('HK');
      expect(body.edition).toBe('GOTY');
      expect(body.platformId).toBe(p.id);
    });

    it('rejects an unknown platformId with 400', async () => {
      const p = await seedPlatform(test.prisma, { name: 'PC', slug: 'pc' });
      const game = await seedGame(test.prisma, {
        title: 'HK',
        platformId: p.id,
      });

      const res = await test.request
        .patch(`/games/${String(game.id)}`)
        .send({ platformId: 999999 });

      expect(res.status).toBe(400);
    });

    it.each([
      ['null title', { title: null }],
      ['null platformId', { platformId: null }],
      ['empty title', { title: '' }],
      ['non-string title', { title: 123 }],
      ['releaseYear below minimum', { releaseYear: 999 }],
      ['non-whitelisted field', { bogus: 1 }],
    ])('rejects %s with 400', async (_name, body) => {
      // The null/blank checks run before the 404 lookup, so no game is needed.
      const res = await test.request.patch('/games/999999').send(body);

      expect(res.status).toBe(400);
    });

    it('returns 404 for an unknown game', async () => {
      const res = await test.request
        .patch('/games/999999')
        .send({ title: 'New' });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /games/:id', () => {
    it('deletes the game (204) and it is gone afterwards', async () => {
      const p = await seedPlatform(test.prisma, { name: 'PC', slug: 'pc' });
      const game = await seedGame(test.prisma, {
        title: 'HK',
        platformId: p.id,
      });

      const del = await test.request.delete(`/games/${String(game.id)}`);
      expect(del.status).toBe(204);

      const get = await test.request.get(`/games/${String(game.id)}`);
      expect(get.status).toBe(404);
    });

    it('returns 404 for an unknown game', async () => {
      const res = await test.request.delete('/games/999999');

      expect(res.status).toBe(404);
    });

    it.each(['abc', '0'])('returns 400 for id "%s"', async (id) => {
      const res = await test.request.delete(`/games/${id}`);

      expect(res.status).toBe(400);
    });
  });
});
