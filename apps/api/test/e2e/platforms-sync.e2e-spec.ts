import type { Server } from 'node:http';
import request from 'supertest';
import { IgdbError, IgdbConfigError } from '../../src/game-catalog/igdb.errors';
import { IgdbClient } from '../../src/game-catalog/igdb.client';
import { ImportJobsService } from '../../src/import-jobs/import-jobs.service';
import { PlatformsService } from '../../src/platforms/platforms.service';
import { PlatformsSyncService } from '../../src/platforms/platforms-sync.service';
import { createTestApp, type TestApp } from '../helpers/test-app';
import { resetDatabase } from '../helpers/reset';
import { seedPlatform } from '../helpers/seed';

describe('Platforms sync (e2e)', () => {
  let test: TestApp;
  let fetchPlatforms: jest.Mock;
  let syncService: PlatformsSyncService;
  let platforms: PlatformsService;
  let importJobs: ImportJobsService;

  beforeAll(async () => {
    fetchPlatforms = jest.fn();
    test = await createTestApp([
      { provide: IgdbClient, useValue: { fetchPlatforms } },
    ]);
    syncService = test.app.get(PlatformsSyncService);
    platforms = test.app.get(PlatformsService);
    importJobs = test.app.get(ImportJobsService);
  });

  beforeEach(async () => {
    fetchPlatforms.mockReset();
    await resetDatabase(test.prisma);
    await test.login();
  });

  afterAll(async () => {
    await test.app.close();
  });

  it('creates missing platforms and reuses a pre-seeded abbreviation match', async () => {
    const custom = await seedPlatform(test.prisma, {
      name: 'PS5',
      slug: 'ps5',
    });
    fetchPlatforms.mockResolvedValue([
      {
        id: 130,
        name: 'PlayStation 5',
        abbreviation: 'PS5',
        platform_family: 1,
        slug: 'ps5',
      },
      { id: 6, name: 'PC', abbreviation: 'PC' },
      { id: 7, name: 'Xbox', abbreviation: 'XBOX' },
    ]);

    const result = await syncService.sync();

    expect(fetchPlatforms).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      fetched: 3,
      created: 2,
      updated: 1,
      unchanged: 0,
    });

    // The custom row kept its name and slug but gained the canonical link.
    await expect(
      test.prisma.platform.findUnique({ where: { id: custom.id } }),
    ).resolves.toMatchObject({
      id: custom.id,
      name: 'PS5',
      slug: 'ps5',
      abbreviation: 'PS5',
      igdbId: 130,
      platformFamily: 1,
    });
    await expect(
      test.prisma.platform.findUnique({ where: { name: 'PC' } }),
    ).resolves.toMatchObject({ igdbId: 6, platformFamily: null });
  });

  it('reuses an existing canonical PC row by exact name when it has no abbreviation (regression)', async () => {
    // C1: the row is named exactly as IGDB names it but carries no
    // abbreviation/alias, so only the pure matcher's exact-name key can match
    // it. Rewriting the input "PC (Microsoft Windows)" to "pc" instead would
    // miss the row, fall through to createCanonical, and hit the unique
    // platforms_name_key (P2002).
    const pc = await seedPlatform(test.prisma, {
      name: 'PC (Microsoft Windows)',
      slug: 'pc',
      igdbId: 6,
    });
    fetchPlatforms.mockResolvedValue([
      {
        id: 6,
        name: 'PC (Microsoft Windows)',
        abbreviation: 'PC',
        platform_family: 1,
      },
    ]);

    const result = await syncService.sync();

    expect(result.created).toBe(0);
    expect(result.updated + result.unchanged).toBe(1);
    await expect(test.prisma.platform.count()).resolves.toBe(1);
    await expect(
      test.prisma.platform.findUnique({ where: { id: pc.id } }),
    ).resolves.toMatchObject({
      id: pc.id,
      name: 'PC (Microsoft Windows)',
      abbreviation: 'PC',
      igdbId: 6,
    });
  });

  it('reuses the canonical PC row by exact name even when a legacy Windows row exists (regression)', async () => {
    const legacy = await seedPlatform(test.prisma, {
      name: 'Windows',
      slug: 'windows',
    });
    const pc = await seedPlatform(test.prisma, {
      name: 'PC (Microsoft Windows)',
      slug: 'pc',
      igdbId: 6,
    });
    fetchPlatforms.mockResolvedValue([
      {
        id: 6,
        name: 'PC (Microsoft Windows)',
        abbreviation: 'PC',
        platform_family: 1,
      },
    ]);

    const result = await syncService.sync();

    expect(result.created).toBe(0);
    expect(result.updated + result.unchanged).toBe(1);
    await expect(test.prisma.platform.count()).resolves.toBe(2);
    await expect(
      test.prisma.platform.findUnique({ where: { id: pc.id } }),
    ).resolves.toMatchObject({ id: pc.id, igdbId: 6 });
    await expect(
      test.prisma.platform.findUnique({ where: { id: legacy.id } }),
    ).resolves.toMatchObject({ id: legacy.id, name: 'Windows', igdbId: null });
  });

  it('is idempotent on a second run', async () => {
    await seedPlatform(test.prisma, { name: 'PS5', slug: 'ps5' });
    fetchPlatforms.mockResolvedValue([
      {
        id: 130,
        name: 'PlayStation 5',
        abbreviation: 'PS5',
        platform_family: 1,
      },
    ]);

    await syncService.sync();
    const second = await syncService.sync();

    expect(second).toEqual({
      fetched: 1,
      created: 0,
      updated: 0,
      unchanged: 1,
    });
  });

  it('matches a renamed platform through its alias without creating a duplicate', async () => {
    const p = await seedPlatform(test.prisma, {
      name: 'PlayStation 5',
      slug: 'ps5',
    });
    await platforms.rename(p.id, { name: 'PS5 Slim' });

    fetchPlatforms.mockResolvedValue([
      {
        id: 130,
        name: 'PlayStation 5',
        abbreviation: 'PS5',
        platform_family: 1,
      },
    ]);

    const result = await syncService.sync();

    expect(result.created).toBe(0);
    expect(result.updated + result.unchanged).toBe(1);
    await expect(
      test.prisma.platform.count({ where: { name: 'PlayStation 5' } }),
    ).resolves.toBe(0);
    await expect(
      test.prisma.platform.findUnique({ where: { id: p.id } }),
    ).resolves.toMatchObject({ name: 'PS5 Slim', igdbId: 130 });
  });

  it('resolves platforms per import without a platform-list call', async () => {
    fetchPlatforms.mockResolvedValue([
      { id: 130, name: 'PlayStation 5', abbreviation: 'PS5' },
    ]);
    await syncService.sync();
    fetchPlatforms.mockClear();

    const resolved = await importJobs.resolvePlatformId([], 'PS5');
    expect(resolved).not.toBeNull();
    expect(resolved?.platformId).toEqual(expect.any(String));
    expect(fetchPlatforms).not.toHaveBeenCalled();
  });

  describe('POST /platforms/refresh', () => {
    it('requires authentication (401)', async () => {
      const server = test.app.getHttpServer() as Server;
      await request.agent(server).post('/platforms/refresh').expect(401);
    });

    it('refreshes the reference list and reports the counts', async () => {
      fetchPlatforms.mockResolvedValue([
        {
          id: 130,
          name: 'PlayStation 5',
          abbreviation: 'PS5',
          platform_family: 1,
        },
        { id: 6, name: 'PC', abbreviation: 'PC' },
      ]);

      const res = await test.request.post('/platforms/refresh').expect(200);

      expect(res.body).toEqual({
        fetched: 2,
        created: 2,
        updated: 0,
        unchanged: 0,
      });
      await expect(test.prisma.platform.count()).resolves.toBe(2);
      await expect(
        test.prisma.platform.findUnique({ where: { name: 'PC' } }),
      ).resolves.toMatchObject({ igdbId: 6 });
    });

    it('restores a hidden reference platform without deleting it', async () => {
      const pc = await seedPlatform(test.prisma, {
        name: 'PC',
        slug: 'pc',
        igdbId: 6,
        hidden: true,
      });
      fetchPlatforms.mockResolvedValue([{ id: 6, name: 'PC' }]);

      await test.request.post('/platforms/refresh').expect(200);

      await expect(
        test.prisma.platform.findUnique({ where: { id: pc.id } }),
      ).resolves.toMatchObject({ id: pc.id, hidden: false });
    });

    it('returns 503 and writes nothing on a transient IGDB failure', async () => {
      fetchPlatforms.mockRejectedValue(
        new IgdbError(true, 'IGDB rate-limited the request'),
      );

      const res = await test.request.post('/platforms/refresh').expect(503);

      expect((res.body as { message: string }).message).toContain(
        'could not be reached',
      );
      await expect(test.prisma.platform.count()).resolves.toBe(0);
    });

    it('returns 503 with the configuration message on a rejected credential', async () => {
      fetchPlatforms.mockRejectedValue(
        new IgdbConfigError('IGDB rejected the credentials'),
      );

      const res = await test.request.post('/platforms/refresh').expect(503);

      expect((res.body as { message: string }).message).toContain(
        'not configured or rejected',
      );
    });
  });
});
