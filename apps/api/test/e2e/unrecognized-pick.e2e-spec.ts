import type {
  CatalogCandidate,
  CatalogSearchResult,
} from '../../src/game-catalog/game-catalog.resolver';
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

  /** Seeds a PC platform, a job, and a flagged item with tied candidates. */
  async function seedItem(): Promise<{
    jobId: string;
    itemId: string;
  }> {
    await test.prisma.platform.create({
      data: { name: 'PC', slug: 'pc', igdbId: 6 },
    });
    const job = await importJobs.createJob({});
    const item = await test.prisma.unrecognizedItem.create({
      data: {
        importJobId: job.id,
        rawTitle: 'Rise of Legends',
        rawPlatform: 'PC',
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
    return { jobId: job.id, itemId: item.id };
  }

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
