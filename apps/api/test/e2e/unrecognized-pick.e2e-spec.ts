import type {
  CatalogCandidate,
  CatalogSearchResult,
} from '../../src/game-catalog/game-catalog.resolver';
import { Prisma } from '../../src/generated/prisma/client';
import { CatalogSearchService } from '../../src/game-catalog/catalog-search.service';
import { ImportJobsService } from '../../src/import-jobs/import-jobs.service';
import { MISSING_ID } from '../helpers/ids';
import { createTestApp, type TestApp } from '../helpers/test-app';
import { resetDatabase } from '../helpers/reset';

interface GameDetailBody {
  id: string;
  title: string;
  edition: string | null;
  coverUrl: string | null;
  images: { url: string; thumbUrl: string | null }[];
  platform: { id: string; name: string; slug: string | null };
}

interface UnrecognizedItemBody {
  id: string;
  dismissedAt: string | null;
}

const CANDIDATE: CatalogCandidate = {
  externalId: 18797,
  title: 'Rise of Nations: Rise of Legends',
  releaseYear: 2006,
  publisher: 'Big Huge Games',
  genre: 'Strategy',
  playerCount: null,
  coverUrl: null,
  images: [],
  platforms: [{ igdbId: 6, name: 'PC', abbreviation: 'PC' }],
  source: 'IGDB',
  slug: 'rise-of-nations-rise-of-legends',
  raw: { id: 18797, name: 'Rise of Nations: Rise of Legends' },
};

const STORED_CANDIDATE = {
  source: 'IGDB',
  externalId: 18797,
  title: 'Rise of Nations: Rise of Legends',
  slug: 'rise-of-nations-rise-of-legends',
  coverUrl: null,
  score: 0.95,
};

/** A search hit on a platform the seeded PC row does not match. */
const XBOX_ONLY: CatalogCandidate = {
  ...CANDIDATE,
  externalId: 1001,
  title: 'Xbox only',
  platforms: [{ igdbId: 12, name: 'Xbox', abbreviation: 'XBOX' }],
};

/** A search hit on the seeded PC platform (igdbId 6). */
const PC_HIT: CatalogCandidate = {
  ...CANDIDATE,
  externalId: 1002,
  title: 'The Pillars of the Earth',
};

describe('Unrecognized item pick (e2e)', () => {
  let test: TestApp;
  let importJobs: ImportJobsService;
  const search = jest.fn<Promise<CatalogSearchResult>, [string]>();

  beforeAll(async () => {
    test = await createTestApp([
      { provide: CatalogSearchService, useValue: { search } },
    ]);
    importJobs = test.app.get(ImportJobsService);
  });

  beforeEach(async () => {
    await resetDatabase(test.prisma);
    search.mockReset();
    search.mockResolvedValue({ kind: 'matches', candidates: [CANDIDATE] });
    await test.login();
  });

  afterAll(async () => {
    await test.app.close();
  });

  /**
   * Seeds a PC platform, a job, and a flagged item with tied candidates.
   * `rawPlatform` defaults to 'PC' (the photo names the platform → verified);
   * pass `null` so the platform comes from the candidate (catalog → unverified).
   */
  async function seedItem(rawPlatform: string | null = 'PC'): Promise<{
    jobId: string;
    itemId: string;
    platformId: string;
  }> {
    const platform = await test.prisma.platform.create({
      data: { name: 'PC', slug: 'pc', igdbId: 6 },
    });
    const job = await importJobs.createJob({});
    const item = await test.prisma.unrecognizedItem.create({
      data: {
        importJobId: job.id,
        rawTitle: 'Rise of Legends',
        rawPlatform,
        rawEdition: 'Gold',
        candidates: [STORED_CANDIDATE],
        reason: 'Multiple IGDB candidates matched equally well — choose one',
      },
    });
    await importJobs.markCompleted(job.id, {
      recognizedCount: 1,
      importedCount: 0,
      unrecognizedCount: 1,
    });
    return { jobId: job.id, itemId: item.id, platformId: platform.id };
  }

  /**
   * Seeds a PC platform, a job, and a flagged no-match item with no stored
   * candidates (the "Filary Ziemi" case the re-search fixes).
   */
  async function seedNoMatchItem(): Promise<{
    jobId: string;
    itemId: string;
    platformId: string;
  }> {
    const platform = await test.prisma.platform.create({
      data: { name: 'PC', slug: 'pc', igdbId: 6 },
    });
    const job = await importJobs.createJob({});
    const item = await test.prisma.unrecognizedItem.create({
      data: {
        importJobId: job.id,
        rawTitle: 'Filary Ziemi',
        rawPlatform: 'PC',
        candidates: Prisma.DbNull,
        reason:
          'No game matched the title in any source — IGDB: No IGDB game matched the title',
      },
    });
    await importJobs.markCompleted(job.id, {
      recognizedCount: 1,
      importedCount: 0,
      unrecognizedCount: 1,
    });
    return { jobId: job.id, itemId: item.id, platformId: platform.id };
  }

  it('re-searches a flagged item and lists platform matches first', async () => {
    const { jobId, itemId, platformId } = await seedNoMatchItem();
    search.mockResolvedValue({
      kind: 'matches',
      candidates: [XBOX_ONLY, PC_HIT],
    });

    const res = await test.request.get(
      `/import-jobs/${jobId}/unrecognized/${itemId}/search?q=The+Pillars+of+the+Earth&platformId=${platformId}`,
    );

    expect(res.status).toBe(200);
    const body = res.body as { candidates: { externalId: number }[] };
    expect(body.candidates.map((candidate) => candidate.externalId)).toEqual([
      1002, 1001,
    ]);
  });

  it('409s a re-search on a dismissed item', async () => {
    const { jobId, itemId } = await seedNoMatchItem();
    await test.prisma.unrecognizedItem.update({
      where: { id: itemId },
      data: { dismissedAt: new Date() },
    });

    const res = await test.request.get(
      `/import-jobs/${jobId}/unrecognized/${itemId}/search?q=pillars`,
    );

    expect(res.status).toBe(409);
  });

  it('404s a re-search when the item belongs to another job', async () => {
    const { itemId } = await seedNoMatchItem();

    const res = await test.request.get(
      `/import-jobs/${MISSING_ID}/unrecognized/${itemId}/search?q=pillars`,
    );

    expect(res.status).toBe(404);
  });

  it('400s a re-search with a malformed platformId', async () => {
    const { jobId, itemId } = await seedNoMatchItem();

    const res = await test.request.get(
      `/import-jobs/${jobId}/unrecognized/${itemId}/search?q=pillars&platformId=not-a-uuid`,
    );

    expect(res.status).toBe(400);
  });

  it('picks a re-searched candidate with the chosen platform and dismisses the item', async () => {
    const { jobId, itemId, platformId } = await seedNoMatchItem();
    search.mockResolvedValue({ kind: 'matches', candidates: [PC_HIT] });

    const res = await test.request
      .post(`/import-jobs/${jobId}/unrecognized/${itemId}/pick`)
      .send({
        source: 'IGDB',
        externalId: 1002,
        query: 'The Pillars of the Earth',
        platformId,
      });

    expect(res.status).toBe(200);
    const body = res.body as GameDetailBody;
    expect(body.title).toBe('The Pillars of the Earth');
    expect(body.platform.id).toBe(platformId);

    expect(await test.prisma.game.count()).toBe(1);
    const game = await test.prisma.game.findFirstOrThrow();
    expect(game.source).toBe('IGDB');
    expect(game.externalId).toBe(1002);
    expect(game.platformId).toBe(platformId);
    expect(game.platformUnverified).toBe(false);

    const stored = await test.prisma.unrecognizedItem.findUniqueOrThrow({
      where: { id: itemId },
    });
    expect(stored.dismissedAt).not.toBeNull();

    const queue = await test.request.get(`/import-jobs/${jobId}/unrecognized`);
    expect(queue.body).toEqual([]);
  });

  it('409s a re-search pick when the candidate is gone from the fresh results', async () => {
    const { jobId, itemId } = await seedNoMatchItem();

    const res = await test.request
      .post(`/import-jobs/${jobId}/unrecognized/${itemId}/pick`)
      .send({
        source: 'IGDB',
        externalId: 1002,
        query: 'The Pillars of the Earth',
      });

    expect(res.status).toBe(409);
    expect(await test.prisma.game.count()).toBe(0);
    const stored = await test.prisma.unrecognizedItem.findUniqueOrThrow({
      where: { id: itemId },
    });
    expect(stored.dismissedAt).toBeNull();
  });

  it('links an existing game on a re-search pick without duplicating it', async () => {
    const { jobId, itemId, platformId } = await seedNoMatchItem();
    await test.prisma.game.create({
      data: {
        title: 'Rise of Nations: Rise of Legends',
        platformId,
        source: 'IGDB',
        externalId: 18797,
      },
    });

    const res = await test.request
      .post(`/import-jobs/${jobId}/unrecognized/${itemId}/pick`)
      .send({
        source: 'IGDB',
        externalId: 18797,
        query: 'Rise of Legends',
      });

    expect(res.status).toBe(200);
    expect(await test.prisma.game.count()).toBe(1);
    const stored = await test.prisma.unrecognizedItem.findUniqueOrThrow({
      where: { id: itemId },
    });
    expect(stored.dismissedAt).not.toBeNull();

    const job = await test.request.get(`/import-jobs/${jobId}`);
    expect(job.body).toMatchObject({
      status: 'done',
      needsAttention: false,
      openFlaggedCount: 0,
    });
  });

  it('creates the game, dismisses the item, and clears it from the review queue', async () => {
    const { jobId, itemId } = await seedItem();

    const res = await test.request
      .post(`/import-jobs/${jobId}/unrecognized/${itemId}/pick`)
      .send({ source: 'IGDB', externalId: 18797 });

    expect(res.status).toBe(200);
    const body = res.body as GameDetailBody;
    expect(body.title).toBe('Rise of Nations: Rise of Legends');
    expect(body.edition).toBe('Gold');
    expect(body.platform.name).toBe('PC');
    expect(body.coverUrl).toBeNull();
    expect(body.images).toEqual([]);

    expect(await test.prisma.game.count()).toBe(1);
    const stored = await test.prisma.unrecognizedItem.findUniqueOrThrow({
      where: { id: itemId },
    });
    expect(stored.dismissedAt).not.toBeNull();

    const queue = await test.request.get(`/import-jobs/${jobId}/unrecognized`);
    expect(queue.status).toBe(200);
    expect(queue.body).toEqual([]);

    const job = await test.request.get(`/import-jobs/${jobId}`);
    expect(job.body).toMatchObject({
      status: 'done',
      needsAttention: false,
      openFlaggedCount: 0,
    });
  });

  it('picks a tied candidate with a confirmed platformId and no query', async () => {
    const { jobId, itemId, platformId } = await seedItem();

    const res = await test.request
      .post(`/import-jobs/${jobId}/unrecognized/${itemId}/pick`)
      .send({ source: 'IGDB', externalId: 18797, platformId });

    expect(res.status).toBe(200);
    expect(await test.prisma.game.count()).toBe(1);
    const game = await test.prisma.game.findFirstOrThrow();
    expect(game.platformId).toBe(platformId);
    expect(game.platformUnverified).toBe(false);
    const stored = await test.prisma.unrecognizedItem.findUniqueOrThrow({
      where: { id: itemId },
    });
    expect(stored.dismissedAt).not.toBeNull();
  });

  it('keeps platformUnverified true when the platform comes from the catalog', async () => {
    // No photo platform: the candidate's PC platform is the only source.
    const { jobId, itemId, platformId } = await seedItem(null);

    const res = await test.request
      .post(`/import-jobs/${jobId}/unrecognized/${itemId}/pick`)
      .send({ source: 'IGDB', externalId: 18797 });

    expect(res.status).toBe(200);
    const game = await test.prisma.game.findFirstOrThrow();
    expect(game.platformId).toBe(platformId);
    expect(game.platformUnverified).toBe(true);
  });

  it('400s a pick with a whitespace-only or too-short query without writing', async () => {
    const { jobId, itemId } = await seedNoMatchItem();

    for (const query of ['   ', 'a']) {
      const res = await test.request
        .post(`/import-jobs/${jobId}/unrecognized/${itemId}/pick`)
        .send({ source: 'IGDB', externalId: 1002, query });
      expect(res.status).toBe(400);
      const message = (res.body as { message?: unknown }).message;
      expect(JSON.stringify(message)).toContain('query');
    }

    expect(search).not.toHaveBeenCalled();
    expect(await test.prisma.game.count()).toBe(0);
    const stored = await test.prisma.unrecognizedItem.findUniqueOrThrow({
      where: { id: itemId },
    });
    expect(stored.dismissedAt).toBeNull();
  });

  it('400s when the picked candidate is not one of the tied candidates', async () => {
    const { jobId, itemId } = await seedItem();

    const res = await test.request
      .post(`/import-jobs/${jobId}/unrecognized/${itemId}/pick`)
      .send({ source: 'IGDB', externalId: 999 });

    expect(res.status).toBe(400);
    expect(await test.prisma.game.count()).toBe(0);
  });

  it('409s when the item was already reviewed', async () => {
    const { jobId, itemId } = await seedItem();
    await test.prisma.unrecognizedItem.update({
      where: { id: itemId },
      data: { dismissedAt: new Date() },
    });

    const res = await test.request
      .post(`/import-jobs/${jobId}/unrecognized/${itemId}/pick`)
      .send({ source: 'IGDB', externalId: 18797 });

    expect(res.status).toBe(409);
  });

  it('404s when the item belongs to another job', async () => {
    const { itemId } = await seedItem();

    const res = await test.request
      .post(`/import-jobs/${MISSING_ID}/unrecognized/${itemId}/pick`)
      .send({ source: 'IGDB', externalId: 18797 });

    expect(res.status).toBe(404);
  });

  it('still dismisses a flagged item via PATCH', async () => {
    const { jobId, itemId } = await seedItem();

    const res = await test.request
      .patch(`/import-jobs/${jobId}/unrecognized/${itemId}`)
      .send({ dismissed: true });

    expect(res.status).toBe(200);
    expect((res.body as UnrecognizedItemBody).dismissedAt).not.toBeNull();
  });
});
