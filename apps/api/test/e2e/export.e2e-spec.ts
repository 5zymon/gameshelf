import request from 'supertest';
import type { Server } from 'node:http';
import { createTestApp, type TestApp } from '../helpers/test-app';
import { resetDatabase } from '../helpers/reset';
import { MISSING_ID } from '../helpers/ids';
import { seedGame, seedPlatform } from '../helpers/seed';

const HEADER_LINE =
  'Title,Platform,Edition,Year,Publisher,Genre,Player count,Copy count,Rating,Source,IGDB link,Date added';

function today(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${String(now.getFullYear())}-${month}-${day}`;
}

/** Minimal RFC 4180 reader: quoted fields may hold commas, quotes and newlines. */
function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (quoted) {
      if (ch === '"' && text.charAt(i + 1) === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      record.push(field);
      field = '';
    } else if (ch === '\r' && text.charAt(i + 1) === '\n') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      i++;
    } else {
      field += ch;
    }
  }
  return records;
}

describe('Export API (e2e)', () => {
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
    await request.agent(server).get('/export/csv').expect(401);
  });

  describe('when signed in', () => {
    beforeEach(async () => {
      await test.login();
    });

    it('rejects an unknown query param (400)', async () => {
      await test.request.get('/export/csv?other=1').expect(400);
    });

    it('returns only the header line for an empty collection', async () => {
      const res = await test.request.get('/export/csv').buffer(true);

      expect(res.status).toBe(200);
      expect(res.text).toBe(`${HEADER_LINE}\r\n`);
    });

    it('exports every game with the right headers and exact lines', async () => {
      const pc = await seedPlatform(test.prisma, { name: 'PC', slug: 'pc' });
      await seedGame(test.prisma, {
        title: 'Mario, "Kart"',
        platformId: pc.id,
        copyCount: 2,
      });
      await seedGame(test.prisma, {
        title: 'Two\nLines',
        platformId: pc.id,
      });
      await seedGame(test.prisma, { title: 'Bare', platformId: pc.id });
      await seedGame(test.prisma, {
        title: 'Zelda',
        platformId: pc.id,
        edition: 'GOTY',
        releaseYear: 1998,
        publisher: 'Nintendo',
        genre: 'Adventure',
        playerCount: 1,
        rating: 72.5,
        source: 'IGDB',
        externalId: 1025,
        igdbSlug: 'zelda',
      });

      const res = await test.request.get('/export/csv').buffer(true);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/^text\/csv/);
      expect(res.headers['content-disposition']).toBe(
        `attachment; filename="gameshelf-${today()}.csv"`,
      );
      expect(res.headers['cache-control']).toBe('no-store');

      const games = await test.request.get('/games');
      const total = (games.body as { meta: { total: number } }).meta.total;
      const records = parseCsv(res.text);
      expect(records[0]?.join(',')).toBe(HEADER_LINE);
      expect(records).toHaveLength(total + 1);

      expect(records.slice(1)).toEqual([
        ['Bare', 'PC', '', '', '', '', '', '1', '', 'manual', '', today()],
        [
          'Mario, "Kart"',
          'PC',
          '',
          '',
          '',
          '',
          '',
          '2',
          '',
          'manual',
          '',
          today(),
        ],
        [
          'Two\nLines',
          'PC',
          '',
          '',
          '',
          '',
          '',
          '1',
          '',
          'manual',
          '',
          today(),
        ],
        [
          'Zelda',
          'PC',
          'GOTY',
          '1998',
          'Nintendo',
          'Adventure',
          '1',
          '1',
          '73',
          'IGDB',
          'https://www.igdb.com/games/zelda',
          today(),
        ],
      ]);
      expect(res.text).toContain('"Mario, ""Kart""",PC,');
    });

    it('orders the same title by platform name, not insertion order', async () => {
      const zeta = await seedPlatform(test.prisma, {
        name: 'Zeta',
        slug: 'zeta',
      });
      const alpha = await seedPlatform(test.prisma, {
        name: 'Alpha',
        slug: 'alpha',
      });
      await seedGame(test.prisma, { title: 'Doom', platformId: zeta.id });
      await seedGame(test.prisma, { title: 'Doom', platformId: alpha.id });

      const res = await test.request.get('/export/csv').buffer(true);

      expect(res.status).toBe(200);
      const rows = parseCsv(res.text)
        .slice(1)
        .map((record) => record.slice(0, 2));
      expect(rows).toEqual([
        ['Doom', 'Alpha'],
        ['Doom', 'Zeta'],
      ]);
    });

    describe('one platform (?platformId=)', () => {
      let a: { id: string };
      let b: { id: string };
      let c: { id: string };

      beforeEach(async () => {
        a = await seedPlatform(test.prisma, { name: 'Alpha', slug: 'alpha' });
        b = await seedPlatform(test.prisma, { name: 'Beta', slug: 'beta' });
        c = await seedPlatform(test.prisma, { name: 'Gamma', slug: 'gamma' });
        await seedGame(test.prisma, { title: 'Verified', platformId: a.id });
        await seedGame(test.prisma, {
          title: 'Unverified',
          platformId: a.id,
          platformUnverified: true,
        });
        await seedGame(test.prisma, { title: 'Other', platformId: b.id });
      });

      it('exports only that platform, unverified games included', async () => {
        const res = await test.request
          .get(`/export/csv?platformId=${a.id}`)
          .buffer(true);

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/^text\/csv/);
        expect(res.headers['content-disposition']).toBe(
          `attachment; filename="gameshelf-${today()}.csv"`,
        );
        expect(res.headers['cache-control']).toBe('no-store');
        const records = parseCsv(res.text);
        expect(records[0]?.join(',')).toBe(HEADER_LINE);
        expect(records.slice(1).map((r) => r.slice(0, 2))).toEqual([
          ['Unverified', 'Alpha'],
          ['Verified', 'Alpha'],
        ]);
      });

      it('returns only the header line for a platform with no games', async () => {
        const res = await test.request
          .get(`/export/csv?platformId=${c.id}`)
          .buffer(true);

        expect(res.status).toBe(200);
        expect(res.text).toBe(`${HEADER_LINE}\r\n`);
      });

      it('accepts an upper-case id (lowercased)', async () => {
        const res = await test.request
          .get(`/export/csv?platformId=${a.id.toUpperCase()}`)
          .buffer(true);

        expect(res.status).toBe(200);
        expect(parseCsv(res.text)).toHaveLength(3);
      });

      it('answers an unknown platform with 404', async () => {
        await test.request
          .get(`/export/csv?platformId=${MISSING_ID}`)
          .expect(404);
      });

      it('answers a malformed id with 400', async () => {
        await test.request.get('/export/csv?platformId=x').expect(400);
      });

      it('answers a repeated platformId with 400', async () => {
        await test.request
          .get(`/export/csv?platformId=${a.id}&platformId=${b.id}`)
          .expect(400);
      });

      it('requires authentication with a platformId (401)', async () => {
        const server = test.app.getHttpServer() as Server;
        await request
          .agent(server)
          .get(`/export/csv?platformId=${a.id}`)
          .expect(401);
      });
    });
  });
});
