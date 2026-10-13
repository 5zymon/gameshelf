import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { UnrecognizedItemPickService } from '../../src/import-jobs/unrecognized-item-pick.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { CatalogSearchService } from '../../src/game-catalog/catalog-search.service';
import type { CatalogCandidate } from '../../src/game-catalog/game-catalog.resolver';
import type { ImportJobsService } from '../../src/import-jobs/import-jobs.service';
import type {
  GameIdentityService,
  IdentityMatch,
} from '../../src/games/game-identity.service';
import type { GameIdentity } from '../../src/games/game-identity';
import {
  toGameDetail,
  type GameDetailRow,
} from '../../src/games/game-detail.mapper';
import type {
  EnrichedGameData,
  GameEnrichmentService,
} from '../../src/enrichment/game-enrichment.service';
import type { CoverMaintenanceService } from '../../src/covers/cover-maintenance.service';
import { testId } from '../helpers/ids';

/** A catalog candidate as returned by a fresh search. */
function candidate(
  overrides: Partial<CatalogCandidate> = {},
): CatalogCandidate {
  return {
    externalId: 18797,
    title: 'Rise of Nations: Rise of Legends',
    releaseYear: null,
    publisher: null,
    genre: null,
    playerCount: null,
    coverUrl: 'https://x/cover.jpg',
    images: [],
    platforms: [{ igdbId: 6, name: 'PC', abbreviation: 'PC' }],
    source: 'IGDB',
    slug: 'ron',
    raw: {},
    ...overrides,
  };
}

/** Enriched (locally cached) game data for the create path. */
function enriched(overrides: Partial<EnrichedGameData> = {}): EnrichedGameData {
  return {
    title: 'Rise of Nations: Rise of Legends',
    platformId: testId(10),
    edition: 'Gold',
    releaseYear: null,
    publisher: null,
    genre: null,
    playerCount: null,
    summary: null,
    rating: null,
    ratingCount: null,
    coverUrl: '/api/covers/cover.jpg',
    sourceCoverUrl: 'https://x/cover.jpg',
    images: [{ url: '/api/covers/img1.jpg', sourceUrl: 'https://x/img1.jpg' }],
    videos: [],
    rawMetadata: '{}',
    enrichedAt: new Date('2026-01-01T00:00:00.000Z'),
    source: 'IGDB',
    externalId: 18797,
    igdbSlug: 'ron',
    ...overrides,
  };
}

/** A `Game` detail row (with the GAME_DETAIL_INCLUDE projection). */
function gameRow(id: string): GameDetailRow {
  return {
    id,
    title: 'Rise of Nations: Rise of Legends',
    edition: 'Gold',
    coverUrl: '/api/covers/cover.jpg',
    rating: null,
    userEditedFields: null,
    source: 'IGDB',
    externalId: 18797,
    sourceCoverUrl: 'https://x/cover.jpg',
    igdbSlug: 'ron',
    platform: { id: testId(10), name: 'PC', slug: 'pc' },
    images: [{ url: '/api/covers/img1.jpg' }],
    videos: [],
  } as unknown as GameDetailRow;
}

const ITEM = {
  id: testId(5),
  importJobId: testId(1),
  rawTitle: 'Rise of Legends',
  rawPlatform: 'PC',
  rawEdition: 'Gold',
  candidates: [
    {
      source: 'IGDB',
      externalId: 18797,
      title: 'Rise of Nations: Rise of Legends',
      slug: 'ron',
      coverUrl: 'https://x/cover.jpg',
      score: 0.95,
    },
  ],
  dismissedAt: null,
};

const REF = { source: 'IGDB' as const, externalId: 18797 };

function createService() {
  const mock = {
    unrecognizedItem: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    game: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  // Interactive transactions run the callback against the same mock as `tx`.
  mock.$transaction.mockImplementation(
    (callback: (tx: typeof mock) => unknown) => callback(mock),
  );
  const catalogSearch = { search: jest.fn() };
  const importJobs = { resolvePlatformId: jest.fn() };
  const identity = {
    findExisting: jest.fn<Promise<IdentityMatch | null>, [GameIdentity]>(() =>
      Promise.resolve(null),
    ),
  };
  const enrichment = { enrichCandidate: jest.fn() };
  const maintenance = {
    removeIfUnreferenced: jest.fn(() => Promise.resolve()),
  };
  const service = new UnrecognizedItemPickService(
    mock as unknown as PrismaService,
    catalogSearch as unknown as CatalogSearchService,
    importJobs as unknown as ImportJobsService,
    identity as unknown as GameIdentityService,
    enrichment as unknown as GameEnrichmentService,
    maintenance as unknown as CoverMaintenanceService,
  );
  return {
    service,
    mock,
    catalogSearch,
    importJobs,
    identity,
    enrichment,
    maintenance,
  };
}

describe('UnrecognizedItemPickService (unit)', () => {
  it('creates the game, claims the item, and returns the game detail', async () => {
    const { service, mock, catalogSearch, importJobs, identity, enrichment } =
      createService();
    mock.unrecognizedItem.findUnique.mockResolvedValue(ITEM);
    catalogSearch.search.mockResolvedValue({
      kind: 'matches',
      candidates: [candidate()],
    });
    importJobs.resolvePlatformId.mockResolvedValue({
      platformId: testId(10),
      provenance: 'catalog',
    });
    identity.findExisting.mockResolvedValue(null);
    enrichment.enrichCandidate.mockResolvedValue(enriched());
    mock.game.create.mockResolvedValue({ id: testId(42) });
    mock.unrecognizedItem.updateMany.mockResolvedValue({ count: 1 });
    mock.game.findUnique.mockResolvedValue(gameRow(testId(42)));

    const result = await service.pick(testId(1), testId(5), REF);

    expect(importJobs.resolvePlatformId).toHaveBeenCalledWith(
      candidate().platforms,
      'PC',
    );
    expect(enrichment.enrichCandidate).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: 18797 }),
      testId(10),
      'Gold',
    );
    expect(mock.game.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ platformUnverified: true }) as unknown,
    });
    expect(mock.unrecognizedItem.updateMany).toHaveBeenCalledWith({
      where: { id: testId(5), dismissedAt: null },
      data: { dismissedAt: expect.any(Date) as Date },
    });
    expect(result).toEqual(toGameDetail(gameRow(testId(42))));
  });

  it('links an existing game and dismisses the item without creating', async () => {
    const { service, mock, catalogSearch, importJobs, identity, enrichment } =
      createService();
    mock.unrecognizedItem.findUnique.mockResolvedValue(ITEM);
    catalogSearch.search.mockResolvedValue({
      kind: 'matches',
      candidates: [candidate()],
    });
    importJobs.resolvePlatformId.mockResolvedValue({
      platformId: testId(10),
      provenance: 'photo',
    });
    identity.findExisting.mockResolvedValue({ id: testId(7), copyCount: 1 });
    mock.game.findUnique.mockResolvedValue(gameRow(testId(7)));
    mock.unrecognizedItem.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.pick(testId(1), testId(5), REF);

    expect(mock.game.create).not.toHaveBeenCalled();
    expect(enrichment.enrichCandidate).not.toHaveBeenCalled();
    expect(mock.unrecognizedItem.updateMany).toHaveBeenCalledWith({
      where: { id: testId(5), dismissedAt: null },
      data: { dismissedAt: expect.any(Date) as Date },
    });
    expect(result).toEqual(toGameDetail(gameRow(testId(7))));
  });

  it('400s when the ref is not one of the stored tied candidates', async () => {
    const { service, mock } = createService();
    mock.unrecognizedItem.findUnique.mockResolvedValue(ITEM);

    await expect(
      service.pick(testId(1), testId(5), { source: 'IGDB', externalId: 999 }),
    ).rejects.toThrow(
      new BadRequestException(
        "The selected candidate is not one of this item's tied candidates",
      ),
    );
  });

  it('409s for an already-reviewed item', async () => {
    const { service, mock } = createService();
    mock.unrecognizedItem.findUnique.mockResolvedValue({
      ...ITEM,
      dismissedAt: new Date('2026-01-02T00:00:00.000Z'),
    });

    await expect(service.pick(testId(1), testId(5), REF)).rejects.toThrow(
      new ConflictException('This flagged item was already reviewed'),
    );
  });

  it('404s when the item belongs to another job', async () => {
    const { service, mock } = createService();
    mock.unrecognizedItem.findUnique.mockResolvedValue({
      ...ITEM,
      importJobId: testId(99),
    });

    await expect(service.pick(testId(1), testId(5), REF)).rejects.toThrow(
      new NotFoundException(
        `Unrecognized item with id ${testId(5)} not found in import job ${testId(1)}`,
      ),
    );
  });

  it('503s when the catalog search is transient', async () => {
    const { service, mock, catalogSearch } = createService();
    mock.unrecognizedItem.findUnique.mockResolvedValue(ITEM);
    catalogSearch.search.mockResolvedValue({
      kind: 'transient',
      reason: 'IGDB 429',
    });

    await expect(service.pick(testId(1), testId(5), REF)).rejects.toThrow(
      new ServiceUnavailableException('IGDB 429'),
    );
  });

  it('409s when the candidate is no longer in the search results', async () => {
    const { service, mock, catalogSearch } = createService();
    mock.unrecognizedItem.findUnique.mockResolvedValue(ITEM);
    catalogSearch.search.mockResolvedValue({
      kind: 'matches',
      candidates: [],
    });

    await expect(service.pick(testId(1), testId(5), REF)).rejects.toThrow(
      new ConflictException('The selected candidate is no longer available'),
    );
  });

  it('409s when no usable platform can be resolved', async () => {
    const { service, mock, catalogSearch, importJobs } = createService();
    mock.unrecognizedItem.findUnique.mockResolvedValue(ITEM);
    catalogSearch.search.mockResolvedValue({
      kind: 'matches',
      candidates: [candidate()],
    });
    importJobs.resolvePlatformId.mockResolvedValue(null);

    await expect(service.pick(testId(1), testId(5), REF)).rejects.toThrow(
      new ConflictException(
        'No usable platform for this candidate — add it manually',
      ),
    );
  });

  it('409s and cleans up assets when the claim races', async () => {
    const {
      service,
      mock,
      catalogSearch,
      importJobs,
      identity,
      enrichment,
      maintenance,
    } = createService();
    mock.unrecognizedItem.findUnique.mockResolvedValue(ITEM);
    catalogSearch.search.mockResolvedValue({
      kind: 'matches',
      candidates: [candidate()],
    });
    importJobs.resolvePlatformId.mockResolvedValue({
      platformId: testId(10),
      provenance: 'catalog',
    });
    identity.findExisting.mockResolvedValue(null);
    enrichment.enrichCandidate.mockResolvedValue(enriched());
    mock.game.create.mockResolvedValue({ id: testId(42) });
    mock.unrecognizedItem.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.pick(testId(1), testId(5), REF)).rejects.toThrow(
      new ConflictException('This flagged item was already reviewed'),
    );
    // The downloaded assets are cleaned up after the rollback.
    expect(maintenance.removeIfUnreferenced).toHaveBeenCalledWith(
      '/api/covers/cover.jpg',
    );
    expect(maintenance.removeIfUnreferenced).toHaveBeenCalledWith(
      '/api/covers/img1.jpg',
    );
  });
});
