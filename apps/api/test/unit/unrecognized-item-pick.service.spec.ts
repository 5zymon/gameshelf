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
import type { CoverPreviewService } from '../../src/covers/cover-preview.service';
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

/** A local platform row as loaded by `loadPlatform`. */
const PLATFORM_ROW = {
  id: testId(10),
  name: 'PC (Microsoft Windows)',
  abbreviation: 'PC',
  alternativeName: null,
  igdbId: 6,
  aliases: [],
};

function createService() {
  const mock = {
    unrecognizedItem: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    platform: {
      findUnique: jest.fn(),
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
  const importJobs = {
    resolvePlatformId: jest.fn(),
    settleReviewedJob: jest.fn(() => Promise.resolve()),
  };
  const identity = {
    findExisting: jest.fn<Promise<IdentityMatch | null>, [GameIdentity]>(() =>
      Promise.resolve(null),
    ),
  };
  const enrichment = { enrichCandidate: jest.fn() };
  const maintenance = {
    removeIfUnreferenced: jest.fn(() => Promise.resolve()),
  };
  const preview = {
    previewUrl: jest.fn((url: string | null) =>
      url === null ? null : '/api/covers/preview?x',
    ),
  };
  const service = new UnrecognizedItemPickService(
    mock as unknown as PrismaService,
    catalogSearch as unknown as CatalogSearchService,
    importJobs as unknown as ImportJobsService,
    identity as unknown as GameIdentityService,
    enrichment as unknown as GameEnrichmentService,
    maintenance as unknown as CoverMaintenanceService,
    preview as unknown as CoverPreviewService,
  );
  return {
    service,
    mock,
    catalogSearch,
    importJobs,
    identity,
    enrichment,
    maintenance,
    preview,
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
    expect(importJobs.settleReviewedJob).toHaveBeenCalledWith(testId(1));
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
    expect(importJobs.settleReviewedJob).toHaveBeenCalledWith(testId(1));
    expect(result).toEqual(toGameDetail(gameRow(testId(7))));
  });

  it('409s without settling when the existing-game claim fails', async () => {
    const { service, mock, catalogSearch, importJobs, identity } =
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
    mock.unrecognizedItem.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.pick(testId(1), testId(5), REF)).rejects.toThrow(
      new ConflictException('This flagged item was already reviewed'),
    );
    // A lost claim leaves the job alone: only a committed claim settles it.
    expect(importJobs.settleReviewedJob).not.toHaveBeenCalled();
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
    const { service, mock, importJobs } = createService();
    mock.unrecognizedItem.findUnique.mockResolvedValue({
      ...ITEM,
      dismissedAt: new Date('2026-01-02T00:00:00.000Z'),
    });

    await expect(service.pick(testId(1), testId(5), REF)).rejects.toThrow(
      new ConflictException('This flagged item was already reviewed'),
    );
    expect(importJobs.settleReviewedJob).not.toHaveBeenCalled();
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

  it('400s for an unknown platformId before the tied-candidate search', async () => {
    const { service, mock, catalogSearch, enrichment } = createService();
    mock.unrecognizedItem.findUnique.mockResolvedValue(ITEM);
    mock.platform.findUnique.mockResolvedValue(null);

    await expect(
      service.pick(testId(1), testId(5), {
        ...REF,
        platformId: testId(11),
      }),
    ).rejects.toThrow(
      new BadRequestException(`Platform with id ${testId(11)} does not exist`),
    );
    // The unknown platform is rejected before any upstream catalog call.
    expect(catalogSearch.search).not.toHaveBeenCalled();
    expect(mock.game.create).not.toHaveBeenCalled();
    expect(enrichment.enrichCandidate).not.toHaveBeenCalled();
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
    // A rollback leaves the job alone: only a committed claim settles it.
    expect(importJobs.settleReviewedJob).not.toHaveBeenCalled();
    // The downloaded assets are cleaned up after the rollback.
    expect(maintenance.removeIfUnreferenced).toHaveBeenCalledWith(
      '/api/covers/cover.jpg',
    );
    expect(maintenance.removeIfUnreferenced).toHaveBeenCalledWith(
      '/api/covers/img1.jpg',
    );
  });

  describe('search', () => {
    it('404s when the item belongs to another job', async () => {
      const { service, mock } = createService();
      mock.unrecognizedItem.findUnique.mockResolvedValue({
        ...ITEM,
        importJobId: testId(99),
      });

      await expect(
        service.search(testId(1), testId(5), { q: 'pillars' }),
      ).rejects.toThrow(
        new NotFoundException(
          `Unrecognized item with id ${testId(5)} not found in import job ${testId(1)}`,
        ),
      );
    });

    it('409s for an already-reviewed item without searching', async () => {
      const { service, mock, catalogSearch } = createService();
      mock.unrecognizedItem.findUnique.mockResolvedValue({
        ...ITEM,
        dismissedAt: new Date('2026-01-02T00:00:00.000Z'),
      });

      await expect(
        service.search(testId(1), testId(5), { q: 'pillars' }),
      ).rejects.toThrow(
        new ConflictException('This flagged item was already reviewed'),
      );
      expect(catalogSearch.search).not.toHaveBeenCalled();
    });

    it('400s for an unknown platformId', async () => {
      const { service, mock, catalogSearch } = createService();
      mock.unrecognizedItem.findUnique.mockResolvedValue(ITEM);
      mock.platform.findUnique.mockResolvedValue(null);

      await expect(
        service.search(testId(1), testId(5), {
          q: 'pillars',
          platformId: testId(11),
        }),
      ).rejects.toThrow(
        new BadRequestException(
          `Platform with id ${testId(11)} does not exist`,
        ),
      );
      expect(catalogSearch.search).not.toHaveBeenCalled();
    });

    it('503s when the catalog search is transient', async () => {
      const { service, mock, catalogSearch } = createService();
      mock.unrecognizedItem.findUnique.mockResolvedValue(ITEM);
      catalogSearch.search.mockResolvedValue({
        kind: 'transient',
        reason: 'IGDB 429',
      });

      await expect(
        service.search(testId(1), testId(5), { q: 'pillars' }),
      ).rejects.toThrow(new ServiceUnavailableException('IGDB 429'));
    });

    it('lists platform matches first (stable) and signs the covers', async () => {
      const { service, mock, catalogSearch, preview } = createService();
      mock.unrecognizedItem.findUnique.mockResolvedValue(ITEM);
      mock.platform.findUnique.mockResolvedValue(PLATFORM_ROW);
      const xbox = candidate({
        externalId: 1,
        title: 'Xbox only',
        coverUrl: 'https://x/xbox.jpg',
        platforms: [{ igdbId: 12, name: 'Xbox', abbreviation: 'XBOX' }],
      });
      const pc = candidate({ externalId: 2, title: 'PC game' });
      catalogSearch.search.mockResolvedValue({
        kind: 'matches',
        candidates: [xbox, pc],
      });

      const result = await service.search(testId(1), testId(5), {
        q: 'pillars',
        platformId: testId(10),
      });

      expect(result.candidates.map((c) => c.externalId)).toEqual([2, 1]);
      expect(result.candidates[0]?.coverUrl).toBe('/api/covers/preview?x');
      expect(preview.previewUrl).toHaveBeenCalledWith('https://x/cover.jpg');
    });

    it('keeps the catalog order without a platformId', async () => {
      const { service, mock, catalogSearch } = createService();
      mock.unrecognizedItem.findUnique.mockResolvedValue(ITEM);
      const xbox = candidate({
        externalId: 1,
        title: 'Xbox only',
        platforms: [{ igdbId: 12, name: 'Xbox', abbreviation: 'XBOX' }],
      });
      const pc = candidate({ externalId: 2, title: 'PC game' });
      catalogSearch.search.mockResolvedValue({
        kind: 'matches',
        candidates: [xbox, pc],
      });

      const result = await service.search(testId(1), testId(5), {
        q: 'pillars',
      });

      expect(result.candidates.map((c) => c.externalId)).toEqual([1, 2]);
    });

    it('searches with the corrected title', async () => {
      const { service, mock, catalogSearch } = createService();
      mock.unrecognizedItem.findUnique.mockResolvedValue(ITEM);
      catalogSearch.search.mockResolvedValue({
        kind: 'matches',
        candidates: [],
      });

      await service.search(testId(1), testId(5), {
        q: 'The Pillars of the Earth',
      });

      expect(catalogSearch.search).toHaveBeenCalledWith(
        'The Pillars of the Earth',
      );
    });
  });

  describe('pick with a re-search query', () => {
    const QUERY_REF = {
      source: 'IGDB' as const,
      externalId: 18797,
      query: 'The Pillars of the Earth',
    };

    it('accepts a candidate absent from the stored ties and re-confirms with the query', async () => {
      const { service, mock, catalogSearch, importJobs, identity, enrichment } =
        createService();
      mock.unrecognizedItem.findUnique.mockResolvedValue({
        ...ITEM,
        candidates: null,
      });
      catalogSearch.search.mockResolvedValue({
        kind: 'matches',
        candidates: [candidate()],
      });
      importJobs.resolvePlatformId.mockResolvedValue({
        platformId: testId(10),
        provenance: 'photo',
      });
      identity.findExisting.mockResolvedValue(null);
      enrichment.enrichCandidate.mockResolvedValue(enriched());
      mock.game.create.mockResolvedValue({ id: testId(42) });
      mock.unrecognizedItem.updateMany.mockResolvedValue({ count: 1 });
      mock.game.findUnique.mockResolvedValue(gameRow(testId(42)));

      const result = await service.pick(testId(1), testId(5), QUERY_REF);

      expect(catalogSearch.search).toHaveBeenCalledTimes(1);
      expect(catalogSearch.search).toHaveBeenCalledWith(
        'The Pillars of the Earth',
      );
      expect(result).toEqual(toGameDetail(gameRow(testId(42))));
    });

    it('re-confirms with the re-search query, not the stored title', async () => {
      const { service, mock, catalogSearch } = createService();
      mock.unrecognizedItem.findUnique.mockResolvedValue(ITEM);
      catalogSearch.search.mockResolvedValue({
        kind: 'matches',
        candidates: [],
      });

      await expect(
        service.pick(testId(1), testId(5), QUERY_REF),
      ).rejects.toThrow(
        new ConflictException('The selected candidate is no longer available'),
      );

      expect(catalogSearch.search).toHaveBeenCalledWith(
        'The Pillars of the Earth',
      );
      expect(catalogSearch.search).not.toHaveBeenCalledWith(
        'Rise of Nations: Rise of Legends',
      );
    });

    it('honours a user-confirmed platformId without resolving from the candidate', async () => {
      const { service, mock, catalogSearch, importJobs, identity, enrichment } =
        createService();
      mock.unrecognizedItem.findUnique.mockResolvedValue({
        ...ITEM,
        candidates: null,
      });
      mock.platform.findUnique.mockResolvedValue({
        ...PLATFORM_ROW,
        id: testId(11),
      });
      catalogSearch.search.mockResolvedValue({
        kind: 'matches',
        candidates: [candidate()],
      });
      identity.findExisting.mockResolvedValue(null);
      enrichment.enrichCandidate.mockResolvedValue(
        enriched({ platformId: testId(11) }),
      );
      mock.game.create.mockResolvedValue({ id: testId(42) });
      mock.unrecognizedItem.updateMany.mockResolvedValue({ count: 1 });
      mock.game.findUnique.mockResolvedValue(gameRow(testId(42)));

      await service.pick(testId(1), testId(5), {
        ...QUERY_REF,
        platformId: testId(11),
      });

      expect(importJobs.resolvePlatformId).not.toHaveBeenCalled();
      expect(enrichment.enrichCandidate).toHaveBeenCalledWith(
        expect.objectContaining({ externalId: 18797 }),
        testId(11),
        'Gold',
      );
      expect(mock.game.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          platformId: testId(11),
          platformUnverified: false,
        }) as unknown,
      });
    });

    it('409s when the candidate is not in the fresh results', async () => {
      const { service, mock, catalogSearch } = createService();
      mock.unrecognizedItem.findUnique.mockResolvedValue({
        ...ITEM,
        candidates: null,
      });
      catalogSearch.search.mockResolvedValue({
        kind: 'matches',
        candidates: [],
      });

      await expect(
        service.pick(testId(1), testId(5), {
          ...QUERY_REF,
          externalId: 999,
        }),
      ).rejects.toThrow(
        new ConflictException('The selected candidate is no longer available'),
      );
    });

    it('400s for an unknown platformId without writing or searching', async () => {
      const { service, mock, catalogSearch, enrichment } = createService();
      mock.unrecognizedItem.findUnique.mockResolvedValue({
        ...ITEM,
        candidates: null,
      });
      catalogSearch.search.mockResolvedValue({
        kind: 'matches',
        candidates: [candidate()],
      });
      mock.platform.findUnique.mockResolvedValue(null);

      await expect(
        service.pick(testId(1), testId(5), {
          ...QUERY_REF,
          platformId: testId(11),
        }),
      ).rejects.toThrow(
        new BadRequestException(
          `Platform with id ${testId(11)} does not exist`,
        ),
      );
      expect(catalogSearch.search).not.toHaveBeenCalled();
      expect(mock.game.create).not.toHaveBeenCalled();
      expect(enrichment.enrichCandidate).not.toHaveBeenCalled();
    });

    it('links an existing identity (no create) and claims the item', async () => {
      const { service, mock, catalogSearch, importJobs, identity, enrichment } =
        createService();
      mock.unrecognizedItem.findUnique.mockResolvedValue({
        ...ITEM,
        candidates: null,
      });
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

      const result = await service.pick(testId(1), testId(5), QUERY_REF);

      expect(mock.game.create).not.toHaveBeenCalled();
      expect(enrichment.enrichCandidate).not.toHaveBeenCalled();
      expect(mock.unrecognizedItem.updateMany).toHaveBeenCalledWith({
        where: { id: testId(5), dismissedAt: null },
        data: { dismissedAt: expect.any(Date) as Date },
      });
      expect(result).toEqual(toGameDetail(gameRow(testId(7))));
    });
  });
});
