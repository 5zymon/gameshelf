import { createTestApp, type TestApp } from '../helpers/test-app';
import { resetDatabase } from '../helpers/reset';
import { seedGame, seedPlatform } from '../helpers/seed';

interface PlatformBody {
  id: number;
  name: string;
  abbreviation: string | null;
  alternativeName: string | null;
  platformFamily: number | null;
  igdbId: number | null;
  slug: string;
  addedByImport: boolean;
  hidden: boolean;
  gameCount: number;
}

describe('Platforms API (e2e)', () => {
  let test: TestApp;

  beforeAll(async () => {
    test = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(test.prisma);
    await test.login();
  });

  afterAll(async () => {
    await test.app.close();
  });

  describe('GET /platforms', () => {
    it('returns an empty list', async () => {
      const res = await test.request.get('/platforms');

      expect(res.status).toBe(200);
      expect(res.body as PlatformBody[]).toEqual([]);
    });

    it('lists platforms sorted by name with a game count each', async () => {
      const ps5 = await seedPlatform(test.prisma, {
        name: 'PlayStation 5',
        slug: 'ps5',
      });
      const pc = await seedPlatform(test.prisma, { name: 'PC', slug: 'pc' });
      await seedGame(test.prisma, { title: 'A', platformId: ps5.id });
      await seedGame(test.prisma, { title: 'B', platformId: ps5.id });

      const res = await test.request.get('/platforms');

      expect(res.status).toBe(200);
      const body = res.body as PlatformBody[];
      expect(body.map((p) => p.name)).toEqual(['PC', 'PlayStation 5']);
      expect(body.map((p) => p.gameCount)).toEqual([0, 2]);
      expect(body[0]?.id).toBe(pc.id);
      expect(body[1]?.id).toBe(ps5.id);
    });

    it('orders import-created platforms first, then by name', async () => {
      await seedPlatform(test.prisma, { name: 'AAA', slug: 'aaa' });
      const imported = await seedPlatform(test.prisma, {
        name: 'ZZZ',
        slug: 'zzz',
        addedByImport: true,
      });

      const res = await test.request.get('/platforms');

      expect(res.status).toBe(200);
      const body = res.body as PlatformBody[];
      expect(body.map((p) => p.name)).toEqual(['ZZZ', 'AAA']);
      expect(body[0]?.id).toBe(imported.id);
      expect(body[0]?.addedByImport).toBe(true);
    });
  });

  describe('GET /platforms/:id', () => {
    it('returns the platform with its game count', async () => {
      const p = await seedPlatform(test.prisma, {
        name: 'PlayStation 5',
        slug: 'ps5',
        abbreviation: 'PS5',
        igdbId: 130,
      });
      await seedGame(test.prisma, { title: 'A', platformId: p.id });

      const res = await test.request.get(`/platforms/${String(p.id)}`);

      expect(res.status).toBe(200);
      expect(res.body as PlatformBody).toEqual({
        id: p.id,
        name: 'PlayStation 5',
        abbreviation: 'PS5',
        alternativeName: null,
        platformFamily: null,
        igdbId: 130,
        slug: 'ps5',
        addedByImport: false,
        hidden: false,
        gameCount: 1,
      });
    });

    it('returns 404 for an unknown id', async () => {
      const res = await test.request.get('/platforms/999999');

      expect(res.status).toBe(404);
    });

    it.each(['abc', '0'])('returns 400 for id "%s"', async (id) => {
      const res = await test.request.get(`/platforms/${id}`);

      expect(res.status).toBe(400);
    });
  });

  describe('POST /platforms', () => {
    it('creates a platform with a generated slug and gameCount 0', async () => {
      const res = await test.request
        .post('/platforms')
        .send({ name: 'PlayStation 5' });

      expect(res.status).toBe(201);
      const body = res.body as PlatformBody;
      expect(body.id).toBeGreaterThan(0);
      expect(body.name).toBe('PlayStation 5');
      expect(body.abbreviation).toBeNull();
      expect(body.alternativeName).toBeNull();
      expect(body.igdbId).toBeNull();
      expect(body.slug).toBe('playstation-5');
      expect(body.addedByImport).toBe(false);
      expect(body.hidden).toBe(false);
      expect(body.gameCount).toBe(0);
    });

    it('trims surrounding whitespace from the name', async () => {
      const res = await test.request
        .post('/platforms')
        .send({ name: '  PlayStation 5  ' });

      expect(res.status).toBe(201);
      const body = res.body as PlatformBody;
      expect(body.name).toBe('PlayStation 5');
      expect(body.slug).toBe('playstation-5');
    });

    it('suffixes the slug on collision (the name is still unique)', async () => {
      await test.request.post('/platforms').send({ name: 'PlayStation 5' });

      const res = await test.request
        .post('/platforms')
        .send({ name: 'PlayStation 5!' });

      expect(res.status).toBe(201);
      const body = res.body as PlatformBody;
      expect(body.name).toBe('PlayStation 5!');
      expect(body.slug).toBe('playstation-5-2');
    });

    it('slugifies unicode names by stripping diacritics', async () => {
      const res = await test.request
        .post('/platforms')
        .send({ name: 'Święta' });

      expect(res.status).toBe(201);
      const body = res.body as PlatformBody;
      expect(body.name).toBe('Święta');
      expect(body.slug).toBe('swieta');
    });

    it('rejects a duplicate name with 409', async () => {
      await test.request.post('/platforms').send({ name: 'PlayStation 5' });

      const res = await test.request
        .post('/platforms')
        .send({ name: 'PlayStation 5' });

      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        statusCode: 409,
        message: 'A platform named "PlayStation 5" already exists',
        error: 'Conflict',
      });
    });

    it.each([
      ['missing name', {}],
      ['empty name', { name: '' }],
      ['whitespace-only name', { name: '   ' }],
      ['name too long', { name: 'a'.repeat(256) }],
      ['non-string name', { name: 123 }],
      ['non-whitelisted field', { name: 'x', bogus: 1 }],
    ])('rejects %s with 400', async (_name, body) => {
      const res = await test.request.post('/platforms').send(body);

      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /platforms/:id', () => {
    it('renames the platform and keeps its slug', async () => {
      const p = await seedPlatform(test.prisma, {
        name: 'PlayStation 5',
        slug: 'ps5',
      });

      const res = await test.request
        .patch(`/platforms/${String(p.id)}`)
        .send({ name: 'PlayStation 5 Pro' });

      expect(res.status).toBe(200);
      const body = res.body as PlatformBody;
      expect(body.name).toBe('PlayStation 5 Pro');
      expect(body.slug).toBe('ps5');
    });

    it('rejects renaming to an existing name with 409', async () => {
      const a = await seedPlatform(test.prisma, { name: 'PC', slug: 'pc' });
      await seedPlatform(test.prisma, { name: 'PlayStation 5', slug: 'ps5' });

      const res = await test.request
        .patch(`/platforms/${String(a.id)}`)
        .send({ name: 'PlayStation 5' });

      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        statusCode: 409,
        message: 'A platform named "PlayStation 5" already exists',
        error: 'Conflict',
      });
    });

    it('sets and clears the canonical fields', async () => {
      const p = await seedPlatform(test.prisma, {
        name: 'PlayStation 5',
        slug: 'ps5',
      });

      const set = await test.request.patch(`/platforms/${String(p.id)}`).send({
        name: 'PlayStation 5',
        abbreviation: 'PS5',
        alternativeName: 'PS5',
        igdbId: 130,
      });
      expect(set.status).toBe(200);
      let body = set.body as PlatformBody;
      expect(body.abbreviation).toBe('PS5');
      expect(body.alternativeName).toBe('PS5');
      expect(body.igdbId).toBe(130);

      const clear = await test.request
        .patch(`/platforms/${String(p.id)}`)
        .send({
          name: 'PlayStation 5',
          abbreviation: null,
          alternativeName: null,
          igdbId: null,
        });
      expect(clear.status).toBe(200);
      body = clear.body as PlatformBody;
      expect(body.abbreviation).toBeNull();
      expect(body.alternativeName).toBeNull();
      expect(body.igdbId).toBeNull();
    });

    it('toggles hidden on a reference platform', async () => {
      const p = await seedPlatform(test.prisma, {
        name: 'PC',
        slug: 'pc',
        igdbId: 6,
      });

      const hide = await test.request
        .patch(`/platforms/${String(p.id)}`)
        .send({ name: 'PC', hidden: true });
      expect(hide.status).toBe(200);
      expect((hide.body as PlatformBody).hidden).toBe(true);

      const show = await test.request
        .patch(`/platforms/${String(p.id)}`)
        .send({ name: 'PC', hidden: false });
      expect(show.status).toBe(200);
      expect((show.body as PlatformBody).hidden).toBe(false);
    });

    it('returns 404 for an unknown platform', async () => {
      const res = await test.request
        .patch('/platforms/999999')
        .send({ name: 'New' });

      expect(res.status).toBe(404);
    });

    it.each([
      ['missing name', {}],
      ['whitespace-only name', { name: '   ' }],
      ['name too long', { name: 'a'.repeat(256) }],
      ['non-string name', { name: 123 }],
      ['igdbId below minimum', { name: 'x', igdbId: 0 }],
      ['non-integer igdbId', { name: 'x', igdbId: 'abc' }],
      ['non-string abbreviation', { name: 'x', abbreviation: 123 }],
      ['abbreviation too long', { name: 'x', abbreviation: 'a'.repeat(256) }],
      [
        'alternativeName too long',
        { name: 'x', alternativeName: 'a'.repeat(256) },
      ],
      ['non-whitelisted field', { name: 'x', bogus: 1 }],
    ])('rejects %s with 400', async (_name, body) => {
      // The blank-name check runs before the 404 lookup, so no platform is needed.
      const res = await test.request.patch('/platforms/999999').send(body);

      expect(res.status).toBe(400);
    });
  });

  describe('POST /platforms/:id/confirm', () => {
    it('clears the added-by-import flag', async () => {
      const p = await seedPlatform(test.prisma, {
        name: 'PlayStaton 5',
        slug: 'playstaton-5',
        addedByImport: true,
      });

      const res = await test.request.post(`/platforms/${String(p.id)}/confirm`);

      expect(res.status).toBe(200);
      const body = res.body as PlatformBody;
      expect(body.addedByImport).toBe(false);
      expect(body.name).toBe('PlayStaton 5');
    });

    it('returns 404 for an unknown platform', async () => {
      const res = await test.request.post('/platforms/999999/confirm');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /platforms/:id/merge', () => {
    it('moves games, aliases the source name, and deletes the source', async () => {
      const target = await seedPlatform(test.prisma, {
        name: 'PlayStation 5',
        slug: 'ps5',
      });
      const source = await seedPlatform(test.prisma, {
        name: 'PlayStaton 5',
        slug: 'playstaton-5',
        addedByImport: true,
      });
      await seedGame(test.prisma, { title: 'A', platformId: source.id });
      await seedGame(test.prisma, { title: 'B', platformId: source.id });

      const res = await test.request
        .post(`/platforms/${String(source.id)}/merge`)
        .send({ targetId: target.id });

      expect(res.status).toBe(200);
      const body = res.body as PlatformBody;
      expect(body.id).toBe(target.id);
      expect(body.gameCount).toBe(2);

      const gone = await test.request.get(`/platforms/${String(source.id)}`);
      expect(gone.status).toBe(404);

      const aliases = await test.prisma.platformAlias.findMany({
        where: { platformId: target.id },
      });
      expect(aliases.map((a) => a.name)).toContain('PlayStaton 5');
    });

    it('rejects merging a platform into itself with 400', async () => {
      const p = await seedPlatform(test.prisma, { name: 'PC', slug: 'pc' });

      const res = await test.request
        .post(`/platforms/${String(p.id)}/merge`)
        .send({ targetId: p.id });

      expect(res.status).toBe(400);
    });

    it('returns 404 for an unknown source or target', async () => {
      const p = await seedPlatform(test.prisma, { name: 'PC', slug: 'pc' });
      await seedPlatform(test.prisma, { name: 'PS5', slug: 'ps5' });

      const noSource = await test.request
        .post('/platforms/999999/merge')
        .send({ targetId: p.id });
      expect(noSource.status).toBe(404);

      const noTarget = await test.request
        .post(`/platforms/${String(p.id)}/merge`)
        .send({ targetId: 999999 });
      expect(noTarget.status).toBe(404);
    });

    it('validates a missing/invalid targetId with 400', async () => {
      const p = await seedPlatform(test.prisma, { name: 'PC', slug: 'pc' });

      const missing = await test.request
        .post(`/platforms/${String(p.id)}/merge`)
        .send({});
      expect(missing.status).toBe(400);

      const invalid = await test.request
        .post(`/platforms/${String(p.id)}/merge`)
        .send({ targetId: 0 });
      expect(invalid.status).toBe(400);
    });
  });

  describe('DELETE /platforms/:id', () => {
    it('deletes a custom platform without games (204) and it is gone afterwards', async () => {
      const p = await seedPlatform(test.prisma, { name: 'PC', slug: 'pc' });

      const del = await test.request.delete(`/platforms/${String(p.id)}`);
      expect(del.status).toBe(204);

      const get = await test.request.get(`/platforms/${String(p.id)}`);
      expect(get.status).toBe(404);
    });

    it('hides a reference platform without games instead of deleting it', async () => {
      const p = await seedPlatform(test.prisma, {
        name: 'PC',
        slug: 'pc',
        igdbId: 6,
      });

      const del = await test.request.delete(`/platforms/${String(p.id)}`);
      expect(del.status).toBe(204);

      const get = await test.request.get(`/platforms/${String(p.id)}`);
      expect(get.status).toBe(200);
      const body = get.body as PlatformBody;
      expect(body.hidden).toBe(true);
      expect(body.igdbId).toBe(6);
    });

    it('refuses with 409 while games reference the platform', async () => {
      const p = await seedPlatform(test.prisma, { name: 'PC', slug: 'pc' });
      await seedGame(test.prisma, { title: 'A', platformId: p.id });
      await seedGame(test.prisma, { title: 'B', platformId: p.id });

      const res = await test.request.delete(`/platforms/${String(p.id)}`);

      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        statusCode: 409,
        message:
          `Platform with id ${String(p.id)} has 2 game(s); ` +
          'reassign or delete them before deleting the platform',
        error: 'Conflict',
      });
    });

    it('returns 404 for an unknown platform', async () => {
      const res = await test.request.delete('/platforms/999999');

      expect(res.status).toBe(404);
    });

    it.each(['abc', '0'])('returns 400 for id "%s"', async (id) => {
      const res = await test.request.delete(`/platforms/${id}`);

      expect(res.status).toBe(400);
    });
  });
});
