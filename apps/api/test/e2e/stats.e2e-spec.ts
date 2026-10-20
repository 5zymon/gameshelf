import request from 'supertest';
import type { Server } from 'node:http';
import { createTestApp, type TestApp } from '../helpers/test-app';
import { resetDatabase } from '../helpers/reset';
import { seedGame, seedPlatform } from '../helpers/seed';

interface StatsBody {
  totals: { games: number; copies: number };
}

describe('Stats API (e2e)', () => {
  let test: TestApp;

  beforeAll(async () => {
    test = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(test.prisma);
  });

  afterAll(async () => {
    await test.app.close();
  });

  it('requires authentication (401)', async () => {
    const server = test.app.getHttpServer() as Server;
    await request.agent(server).get('/stats').expect(401);
  });

  describe('when signed in', () => {
    beforeEach(async () => {
      await test.login();
    });

    it('returns zeros for an empty collection', async () => {
      const res = await test.request.get('/stats');

      expect(res.status).toBe(200);
      expect(res.body as StatsBody).toEqual({
        totals: { games: 0, copies: 0 },
      });
    });

    it('counts games and sums copies, matching GET /games meta.total', async () => {
      const p = await seedPlatform(test.prisma, { name: 'PC', slug: 'pc' });
      await seedGame(test.prisma, {
        title: 'One copy',
        platformId: p.id,
        copyCount: 1,
      });
      await seedGame(test.prisma, {
        title: 'Three copies',
        platformId: p.id,
        copyCount: 3,
      });

      const res = await test.request.get('/stats');
      const list = await test.request.get('/games');

      expect(res.status).toBe(200);
      const body = res.body as StatsBody;
      expect(body.totals).toEqual({ games: 2, copies: 4 });
      expect(body.totals.games).toBe(
        (list.body as { meta: { total: number } }).meta.total,
      );
    });

    it('rejects an unknown query param with 400', async () => {
      const res = await test.request.get('/stats?foo=bar');

      expect(res.status).toBe(400);
    });
  });
});
