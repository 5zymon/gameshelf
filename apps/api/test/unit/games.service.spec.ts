import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { CatalogCandidate } from '../../src/game-catalog/game-catalog.resolver';
import type { GameCatalogResolver } from '../../src/game-catalog/game-catalog.resolver';
import type { CreateGameDto } from '../../src/games/dto/create-game.dto';
import type { ListGamesQueryDto } from '../../src/games/dto/list-games-query.dto';
import type { UpdateGameDto } from '../../src/games/dto/update-game.dto';
import { GamesService } from '../../src/games/games.service';
import type { GameEnrichmentService } from '../../src/enrichment/game-enrichment.service';
import {
  serializeEditedFields,
  TRACKED_METADATA_FIELDS,
} from '../../src/enrichment/reenrichment';
import type { PrismaService } from '../../src/prisma/prisma.service';

const PLATFORM_SELECT = { id: true, name: true, slug: true };

interface GamesPrismaMock {
  game: {
    findMany: jest.Mock;
    count: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  platform: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
  };
}

interface GamesServiceHarness {
  service: GamesService;
  mock: GamesPrismaMock;
  catalog: { resolve: jest.Mock };
  catalogSearch: { search: jest.Mock };
  identity: { findExisting: jest.Mock };
  enrichment: { enrichCandidate: jest.Mock };
  covers: { cacheFromUrl: jest.Mock; fileFromServedUrl: jest.Mock };
  preview: { previewUrl: jest.Mock };
  maintenance: { removeIfUnreferenced: jest.Mock };
}

const PREVIEW_URL = '/api/covers/preview?u=b64&s=sig';

function createService(): GamesServiceHarness {
  const mock: GamesPrismaMock = {
    game: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    platform: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
  };
  const catalog = { resolve: jest.fn() };
  const catalogSearch = {
    search: jest.fn(() =>
      Promise.resolve({
        kind: 'matches',
        candidates: [] as CatalogCandidate[],
      }),
    ),
  };
  const identity = { findExisting: jest.fn(() => Promise.resolve(null)) };
  const enrichment = { enrichCandidate: jest.fn() };
  const covers = {
    cacheFromUrl: jest.fn(() => Promise.resolve(null as string | null)),
    fileFromServedUrl: jest.fn(() => null as string | null),
  };
  const preview = { previewUrl: jest.fn(() => PREVIEW_URL as string | null) };
  const maintenance = {
    removeIfUnreferenced: jest.fn(() => Promise.resolve()),
  };
  return {
    service: new GamesService(
      mock as unknown as PrismaService,
      catalog as unknown as GameCatalogResolver,
      catalogSearch as never,
      identity as never,
      enrichment as unknown as GameEnrichmentService,
      covers as never,
      preview as never,
      maintenance as never,
    ),
    mock,
    catalog,
    catalogSearch,
    identity,
    enrichment,
    covers,
    preview,
    maintenance,
  };
}

describe('GamesService (unit)', () => {
  let service: GamesService;
  let mock: GamesPrismaMock;
  let catalog: { resolve: jest.Mock };
  let catalogSearch: { search: jest.Mock };
  let identity: { findExisting: jest.Mock };
  let enrichment: { enrichCandidate: jest.Mock };
  let covers: { cacheFromUrl: jest.Mock; fileFromServedUrl: jest.Mock };
  let preview: { previewUrl: jest.Mock };
  let maintenance: { removeIfUnreferenced: jest.Mock };

  beforeEach(() => {
    ({
      service,
      mock,
      catalog,
      catalogSearch,
      identity,
      enrichment,
      covers,
      preview,
      maintenance,
    } = createService());
  });

  describe('list', () => {
    it('applies defaults: page 1, limit 20, id-asc order, empty where', async () => {
      // game.findMany is called twice: items first, then distinct editions.
      mock.game.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      mock.game.count.mockResolvedValue(0);
      mock.platform.findMany.mockResolvedValue([]);

      const result = await service.list({});

      expect(mock.game.findMany).toHaveBeenNthCalledWith(1, {
        select: {
          id: true,
          title: true,
          edition: true,
          coverUrl: true,
          platform: { select: PLATFORM_SELECT },
        },
        where: {},
        orderBy: [{ id: 'asc' }],
        skip: 0,
        take: 20,
      });
      expect(mock.game.count).toHaveBeenCalledWith({ where: {} });
      expect(mock.platform.findMany).toHaveBeenCalledWith({
        where: { games: { some: {} } },
        select: PLATFORM_SELECT,
        orderBy: { name: 'asc' },
      });
      expect(mock.game.findMany).toHaveBeenNthCalledWith(2, {
        distinct: ['edition'],
        where: { edition: { not: null } },
        select: { edition: true },
        orderBy: { edition: 'asc' },
      });
      expect(result).toEqual({
        items: [],
        meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
        filters: { platforms: [], editions: [] },
      });
    });

    it('composes all filters with trimmed strings', async () => {
      mock.game.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      mock.game.count.mockResolvedValue(0);
      mock.platform.findMany.mockResolvedValue([]);

      await service.list({
        platformId: 2,
        edition: '  GOTY  ',
        year: 2017,
        publisher: '  Team Cherry  ',
        genre: '  Metroidvania  ',
        playerCount: 1,
        q: '  hollow  ',
      });

      expect(mock.game.findMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: {
            platformId: 2,
            edition: 'GOTY',
            releaseYear: 2017,
            publisher: 'Team Cherry',
            genre: 'Metroidvania',
            playerCount: 1,
            title: { contains: 'hollow' },
          },
        }),
      );
      expect(mock.game.count).toHaveBeenCalledWith({
        where: {
          platformId: 2,
          edition: 'GOTY',
          releaseYear: 2017,
          publisher: 'Team Cherry',
          genre: 'Metroidvania',
          playerCount: 1,
          title: { contains: 'hollow' },
        },
      });
    });

    it('drops whitespace-only string filters', async () => {
      mock.game.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      mock.game.count.mockResolvedValue(0);
      mock.platform.findMany.mockResolvedValue([]);

      await service.list({
        edition: '   ',
        publisher: '   ',
        genre: '   ',
        q: '   ',
      });

      expect(mock.game.findMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ where: {} }),
      );
    });

    it('escapes LIKE wildcards in q (%, _, \\)', async () => {
      mock.game.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      mock.game.count.mockResolvedValue(0);
      mock.platform.findMany.mockResolvedValue([]);

      await service.list({ q: '100%_off\\' });

      expect(mock.game.findMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: { title: { contains: '100\\%\\_off\\\\' } },
        }),
      );
    });

    const orderByCases: [ListGamesQueryDto, unknown][] = [
      [{ sort: 'title', order: 'desc' }, [{ title: 'desc' }, { id: 'asc' }]],
      [
        { sort: 'year' },
        [{ releaseYear: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
      ],
      [
        { sort: 'platform', order: 'desc' },
        [{ platform: { name: 'desc' } }, { id: 'asc' }],
      ],
      [{ sort: 'createdAt' }, [{ createdAt: 'asc' }, { id: 'asc' }]],
      [{}, [{ id: 'asc' }]],
    ];

    it.each(orderByCases)(
      'builds orderBy for %o (id is always the tiebreaker)',
      async (query, expected) => {
        mock.game.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
        mock.game.count.mockResolvedValue(0);
        mock.platform.findMany.mockResolvedValue([]);

        await service.list(query);

        expect(mock.game.findMany).toHaveBeenNthCalledWith(
          1,
          expect.objectContaining({ orderBy: expected }),
        );
      },
    );

    it('computes skip/take and totalPages', async () => {
      mock.game.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      mock.game.count.mockResolvedValue(42);
      mock.platform.findMany.mockResolvedValue([]);

      const result = await service.list({ page: 3, limit: 10 });

      expect(mock.game.findMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ skip: 20, take: 10 }),
      );
      expect(result.meta).toEqual({
        page: 3,
        limit: 10,
        total: 42,
        totalPages: 5,
      });
    });

    it('exposes distinct non-null editions in filters', async () => {
      mock.game.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ edition: 'GOTY' }, { edition: null }]);
      mock.game.count.mockResolvedValue(0);
      mock.platform.findMany.mockResolvedValue([]);

      const result = await service.list({});

      expect(result.filters.editions).toEqual(['GOTY']);
    });

    it('adds a same-origin coverThumbUrl to each item', async () => {
      const coverUrl = `/api/covers/${'c'.repeat(32)}.jpg`;
      mock.game.findMany
        .mockResolvedValueOnce([
          {
            id: 1,
            title: 'HK',
            edition: null,
            coverUrl,
            platform: { id: 1, name: 'PC', slug: 'pc' },
          },
        ])
        .mockResolvedValueOnce([]);
      mock.game.count.mockResolvedValue(1);
      mock.platform.findMany.mockResolvedValue([]);

      const result = await service.list({});

      expect(result.items[0]).toEqual({
        id: 1,
        title: 'HK',
        edition: null,
        coverUrl,
        coverThumbUrl: `/api/covers/thumbs/${'c'.repeat(32)}.jpg`,
        platform: { id: 1, name: 'PC', slug: 'pc' },
      });
    });
  });

  describe('findOne', () => {
    it('returns the game with its platform projection', async () => {
      const game = {
        id: 7,
        title: 'Hollow Knight',
        platform: { id: 1, name: 'PS5', slug: 'ps5' },
      };
      mock.game.findUnique.mockResolvedValue(game);

      const result = await service.findOne(7);

      expect(mock.game.findUnique).toHaveBeenCalledWith({
        where: { id: 7 },
        include: { platform: { select: PLATFORM_SELECT } },
      });
      expect(result).toEqual({
        ...game,
        coverThumbUrl: null,
        userEditedFields: [],
      });
    });

    it('throws 404 for an unknown id', async () => {
      mock.game.findUnique.mockResolvedValue(null);

      await expect(service.findOne(7)).rejects.toThrow(
        new NotFoundException('Game with id 7 not found'),
      );
    });
  });

  describe('create', () => {
    it('creates with null defaults for omitted optional fields', async () => {
      mock.platform.findUnique.mockResolvedValue({ id: 1 });
      const created = { id: 1, title: 'HK', platformId: 1 };
      mock.game.create.mockResolvedValue(created);

      const result = await service.create({ title: 'HK', platformId: 1 });

      expect(mock.platform.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        select: { id: true },
      });
      expect(mock.game.create).toHaveBeenCalledWith({
        data: {
          title: 'HK',
          platformId: 1,
          edition: null,
          releaseYear: null,
          publisher: null,
          genre: null,
          playerCount: null,
          coverUrl: null,
          sourceCoverUrl: null,
        },
        include: { platform: { select: PLATFORM_SELECT } },
      });
      expect(result).toEqual({
        ...created,
        coverThumbUrl: null,
        userEditedFields: [],
      });
    });

    it('passes every provided field through and records provenance', async () => {
      mock.platform.findUnique.mockResolvedValue({ id: 2 });
      const created = { id: 1 };
      mock.game.create.mockResolvedValue(created);
      covers.cacheFromUrl.mockResolvedValue(
        `/api/covers/${'a'.repeat(32)}.jpg`,
      );
      const dto: CreateGameDto = {
        title: 'HK',
        platformId: 2,
        edition: 'GOTY',
        releaseYear: 2017,
        publisher: 'Team Cherry',
        genre: 'Metroidvania',
        playerCount: 1,
        coverUrl: 'https://example.com/hk.jpg',
      };

      await service.create(dto);

      // An external cover URL is downloaded and kept same-origin; the external
      // URL is stored internally for retries, never in the response.
      expect(covers.cacheFromUrl).toHaveBeenCalledWith(
        'https://example.com/hk.jpg',
      );
      expect(mock.game.create).toHaveBeenCalledWith({
        data: {
          title: 'HK',
          platformId: 2,
          edition: 'GOTY',
          releaseYear: 2017,
          publisher: 'Team Cherry',
          genre: 'Metroidvania',
          playerCount: 1,
          coverUrl: `/api/covers/${'a'.repeat(32)}.jpg`,
          sourceCoverUrl: 'https://example.com/hk.jpg',
          userEditedFields: serializeEditedFields(TRACKED_METADATA_FIELDS),
        },
        include: { platform: { select: PLATFORM_SELECT } },
      });
    });

    it('keeps a same-origin cover path as-is without a download', async () => {
      mock.platform.findUnique.mockResolvedValue({ id: 2 });
      mock.game.create.mockResolvedValue({ id: 1 });
      const local = `/api/covers/${'b'.repeat(32)}.png`;

      await service.create({ title: 'HK', platformId: 2, coverUrl: local });

      expect(covers.cacheFromUrl).not.toHaveBeenCalled();
      expect(mock.game.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            coverUrl: local,
            sourceCoverUrl: null,
          }) as unknown,
        }),
      );
    });

    it('keeps a failed cover download as a placeholder with a source link', async () => {
      mock.platform.findUnique.mockResolvedValue({ id: 2 });
      mock.game.create.mockResolvedValue({ id: 1 });
      covers.cacheFromUrl.mockResolvedValue(null);

      await service.create({
        title: 'HK',
        platformId: 2,
        coverUrl: 'https://example.com/hk.jpg',
      });

      expect(mock.game.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            coverUrl: null,
            sourceCoverUrl: 'https://example.com/hk.jpg',
          }) as unknown,
        }),
      );
    });

    it('rejects with 400 when the platform does not exist', async () => {
      mock.platform.findUnique.mockResolvedValue(null);

      await expect(
        service.create({ title: 'HK', platformId: 999 }),
      ).rejects.toThrow(
        new BadRequestException('Platform with id 999 does not exist'),
      );
      expect(mock.game.create).not.toHaveBeenCalled();
    });

    it('rejects a duplicate unlinked identity with 409 carrying the existing game', async () => {
      mock.platform.findUnique.mockResolvedValue({ id: 1 });
      identity.findExisting.mockResolvedValue({ id: 9, copyCount: 3 });
      const existingGame = {
        id: 9,
        title: 'HK',
        platformId: 1,
        copyCount: 3,
        sourceCoverUrl: null,
        userEditedFields: null,
        platform: { id: 1, name: 'PS5', slug: 'ps5' },
      };
      mock.game.findUnique.mockResolvedValue(existingGame);

      let caught: unknown;
      try {
        await service.create({ title: 'HK', platformId: 1 });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(ConflictException);
      const response = (caught as ConflictException).getResponse() as {
        code: string;
        game: { id: number; copyCount: number };
      };
      expect(response.code).toBe('GAME_ALREADY_IN_CATALOG');
      expect(response.game.id).toBe(9);
      expect(response.game.copyCount).toBe(3);
      expect(identity.findExisting).toHaveBeenCalledWith({
        title: 'HK',
        platformId: 1,
        edition: null,
        source: 'MANUAL',
        externalId: null,
      });
      expect(mock.game.create).not.toHaveBeenCalled();
      expect(covers.cacheFromUrl).not.toHaveBeenCalled();
    });

    const linkedCandidate: CatalogCandidate = {
      externalId: 1036,
      title: 'Halo: Combat Evolved',
      releaseYear: 2001,
      publisher: 'Bungie',
      genre: 'Shooter',
      playerCount: 16,
      coverUrl: 'https://images.igdb.com/igdb/image/upload/t_thumb/co61gh.jpg',
      platforms: [{ igdbId: 11, name: 'Xbox', abbreviation: 'XBOX' }],
      source: 'IGDB',
      raw: { id: 1036 },
    };

    it('creates a linked game from a verified pick (enrichment is the source)', async () => {
      mock.platform.findUnique.mockResolvedValue({ id: 3 });
      catalogSearch.search.mockResolvedValue({
        kind: 'matches',
        candidates: [linkedCandidate],
      });
      const enriched = {
        title: 'Halo: Combat Evolved',
        platformId: 3,
        edition: 'GOTY',
        releaseYear: 2001,
        publisher: 'Bungie',
        genre: 'Shooter',
        playerCount: 16,
        coverUrl: '/api/covers/abc.jpg',
        sourceCoverUrl: linkedCandidate.coverUrl,
        rawMetadata: JSON.stringify({ id: 1036 }),
        enrichedAt: new Date('2026-10-07T00:00:00.000Z'),
        source: 'IGDB' as const,
        externalId: 1036,
      };
      enrichment.enrichCandidate.mockResolvedValue(enriched);
      mock.game.create.mockResolvedValue({ id: 42, ...enriched });

      const result = await service.create({
        title: 'Halo',
        platformId: 3,
        edition: 'GOTY',
        candidate: { source: 'IGDB', externalId: 1036 },
      });

      expect(catalogSearch.search).toHaveBeenCalledWith('Halo');
      expect(identity.findExisting).toHaveBeenCalledWith({
        title: 'Halo: Combat Evolved',
        platformId: 3,
        edition: 'GOTY',
        source: 'IGDB',
        externalId: 1036,
      });
      expect(enrichment.enrichCandidate).toHaveBeenCalledWith(
        linkedCandidate,
        3,
        'GOTY',
      );
      expect(mock.game.create).toHaveBeenCalledWith({
        data: enriched,
        include: { platform: { select: PLATFORM_SELECT } },
      });
      expect(result.id).toBe(42);
    });

    it('rejects a pick that no longer appears in a fresh search (409)', async () => {
      mock.platform.findUnique.mockResolvedValue({ id: 3 });
      catalogSearch.search.mockResolvedValue({
        kind: 'matches',
        candidates: [],
      });

      await expect(
        service.create({
          title: 'Halo',
          platformId: 3,
          candidate: { source: 'IGDB', externalId: 999 },
        }),
      ).rejects.toThrow(ConflictException);
      expect(enrichment.enrichCandidate).not.toHaveBeenCalled();
      expect(mock.game.create).not.toHaveBeenCalled();
    });

    it('rejects a duplicate linked identity without downloading the cover', async () => {
      mock.platform.findUnique.mockResolvedValue({ id: 3 });
      catalogSearch.search.mockResolvedValue({
        kind: 'matches',
        candidates: [linkedCandidate],
      });
      identity.findExisting.mockResolvedValue({ id: 9, copyCount: 1 });
      mock.game.findUnique.mockResolvedValue({
        id: 9,
        platform: { id: 3, name: 'Xbox', slug: 'xbox' },
        sourceCoverUrl: null,
        userEditedFields: null,
      });

      await expect(
        service.create({
          title: 'Halo',
          platformId: 3,
          candidate: { source: 'IGDB', externalId: 1036 },
        }),
      ).rejects.toThrow(ConflictException);
      expect(enrichment.enrichCandidate).not.toHaveBeenCalled();
      expect(mock.game.create).not.toHaveBeenCalled();
    });
  });

  describe('search', () => {
    const candidate: CatalogCandidate = {
      externalId: 1036,
      title: 'Halo: Combat Evolved',
      releaseYear: 2001,
      publisher: 'Bungie',
      genre: 'Shooter',
      playerCount: 16,
      coverUrl: 'https://images.igdb.com/igdb/image/upload/t_thumb/co61gh.jpg',
      platforms: [{ igdbId: 11, name: 'Xbox', abbreviation: 'XBOX' }],
      source: 'IGDB',
      raw: { id: 1036 },
    };

    it('maps candidates through a same-origin preview cover and strips raw', async () => {
      catalogSearch.search.mockResolvedValue({
        kind: 'matches',
        candidates: [candidate],
      });
      preview.previewUrl.mockReturnValue('/api/covers/preview?u=abc&s=sig');

      const result = await service.search({ q: 'halo' });

      expect(catalogSearch.search).toHaveBeenCalledWith('halo');
      expect(preview.previewUrl).toHaveBeenCalledWith(candidate.coverUrl);
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]).toMatchObject({
        externalId: 1036,
        title: 'Halo: Combat Evolved',
        coverUrl: '/api/covers/preview?u=abc&s=sig',
      });
      expect((result.candidates[0] as { raw?: unknown }).raw).toBeUndefined();
    });

    it('defaults a missing q to an empty query', async () => {
      catalogSearch.search.mockResolvedValue({
        kind: 'matches',
        candidates: [],
      });

      await service.search({});

      expect(catalogSearch.search).toHaveBeenCalledWith('');
    });

    it('maps transient and config_error to 503', async () => {
      catalogSearch.search.mockResolvedValue({
        kind: 'transient',
        reason: 'IGDB 429',
      });
      await expect(service.search({ q: 'halo' })).rejects.toThrow(
        ServiceUnavailableException,
      );

      catalogSearch.search.mockResolvedValue({
        kind: 'config_error',
        source: 'igdb',
        reason: 'IGDB rejected the credentials',
      });
      await expect(service.search({ q: 'halo' })).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });

  describe('addCopy', () => {
    it('increments copyCount atomically and returns the detail', async () => {
      mock.game.findUnique.mockResolvedValue({ id: 5 });
      mock.game.update.mockResolvedValue({
        id: 5,
        copyCount: 2,
        sourceCoverUrl: null,
        userEditedFields: null,
        platform: { id: 1, name: 'PS5', slug: 'ps5' },
      });

      const result = await service.addCopy(5);

      expect(mock.game.update).toHaveBeenCalledWith({
        where: { id: 5 },
        data: { copyCount: { increment: 1 } },
        include: { platform: { select: PLATFORM_SELECT } },
      });
      expect(result.copyCount).toBe(2);
    });

    it('throws 404 for an unknown game', async () => {
      mock.game.findUnique.mockResolvedValue(null);

      await expect(service.addCopy(5)).rejects.toThrow(
        new NotFoundException('Game with id 5 not found'),
      );
      expect(mock.game.update).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('rejects an explicit null title with 400', async () => {
      await expect(
        service.update(1, {
          title: null,
          platformId: 1,
        } as unknown as UpdateGameDto),
      ).rejects.toThrow(new BadRequestException('title must not be null'));
      expect(mock.game.findUnique).not.toHaveBeenCalled();
    });

    it('rejects an explicit null platformId with 400', async () => {
      await expect(
        service.update(1, {
          title: 'HK',
          platformId: null,
        } as unknown as UpdateGameDto),
      ).rejects.toThrow(new BadRequestException('platformId must not be null'));
      expect(mock.game.findUnique).not.toHaveBeenCalled();
    });

    it('throws 404 for an unknown game', async () => {
      mock.game.findUnique.mockResolvedValue(null);

      await expect(service.update(7, { title: 'New' })).rejects.toThrow(
        new NotFoundException('Game with id 7 not found'),
      );
      expect(mock.game.update).not.toHaveBeenCalled();
    });

    it('validates the new platform before updating', async () => {
      mock.game.findUnique.mockResolvedValue({ id: 3 });
      mock.platform.findUnique.mockResolvedValue(null);

      await expect(service.update(3, { platformId: 5 })).rejects.toThrow(
        new BadRequestException('Platform with id 5 does not exist'),
      );
      expect(mock.game.update).not.toHaveBeenCalled();
    });

    it('sends only the provided fields (partial dto)', async () => {
      mock.game.findUnique.mockResolvedValue({ id: 3 });
      const updated = { id: 3, title: 'New' };
      mock.game.update.mockResolvedValue(updated);

      const result = await service.update(3, { title: 'New' });

      expect(mock.platform.findUnique).not.toHaveBeenCalled();
      expect(mock.game.update).toHaveBeenCalledWith({
        where: { id: 3 },
        data: { title: 'New' },
        include: { platform: { select: PLATFORM_SELECT } },
      });
      expect(result).toEqual({
        ...updated,
        coverThumbUrl: null,
        userEditedFields: [],
      });
    });

    it('downloads and keeps an external cover same-origin on update', async () => {
      mock.game.findUnique.mockResolvedValue({ id: 3, coverUrl: null });
      const local = `/api/covers/${'d'.repeat(32)}.jpg`;
      covers.cacheFromUrl.mockResolvedValue(local);
      mock.game.update.mockResolvedValue({ id: 3, coverUrl: local });

      await service.update(3, { coverUrl: 'https://example.com/new.jpg' });

      expect(covers.cacheFromUrl).toHaveBeenCalledWith(
        'https://example.com/new.jpg',
      );
      expect(mock.game.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            coverUrl: local,
            sourceCoverUrl: 'https://example.com/new.jpg',
          }) as unknown,
        }),
      );
      expect(maintenance.removeIfUnreferenced).toHaveBeenCalledWith(null, 3);
    });

    it('clears the cover and source link with an explicit null', async () => {
      mock.game.findUnique.mockResolvedValue({
        id: 3,
        coverUrl: `/api/covers/${'e'.repeat(32)}.jpg`,
      });
      mock.game.update.mockResolvedValue({ id: 3, coverUrl: null });

      await service.update(3, {
        coverUrl: null,
      } as unknown as UpdateGameDto);

      expect(covers.cacheFromUrl).not.toHaveBeenCalled();
      expect(mock.game.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            coverUrl: null,
            sourceCoverUrl: null,
          }) as unknown,
        }),
      );
      // The replaced file is removed (ref-counted).
      expect(maintenance.removeIfUnreferenced).toHaveBeenCalledWith(
        `/api/covers/${'e'.repeat(32)}.jpg`,
        3,
      );
    });

    it('preserves the stored source link when the current local path is re-submitted', async () => {
      const local = `/api/covers/${'a'.repeat(32)}.jpg`;
      const source =
        'https://images.igdb.com/igdb/image/upload/t_thumb/co61gh.jpg';
      mock.game.findUnique.mockResolvedValue({
        id: 3,
        coverUrl: local,
        sourceCoverUrl: source,
      });
      mock.game.update.mockResolvedValue({ id: 3, coverUrl: local });

      await service.update(3, { coverUrl: local });

      expect(covers.cacheFromUrl).not.toHaveBeenCalled();
      expect(mock.game.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            coverUrl: local,
            sourceCoverUrl: source,
          }) as unknown,
        }),
      );
      // The cover did not change, so nothing is removed.
      expect(maintenance.removeIfUnreferenced).not.toHaveBeenCalled();
    });

    it('clears the source link when a different local path is submitted', async () => {
      const oldLocal = `/api/covers/${'a'.repeat(32)}.jpg`;
      const newLocal = `/api/covers/${'b'.repeat(32)}.jpg`;
      mock.game.findUnique.mockResolvedValue({
        id: 3,
        coverUrl: oldLocal,
        sourceCoverUrl:
          'https://images.igdb.com/igdb/image/upload/t_thumb/co61gh.jpg',
      });
      mock.game.update.mockResolvedValue({ id: 3, coverUrl: newLocal });

      await service.update(3, { coverUrl: newLocal });

      expect(mock.game.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            coverUrl: newLocal,
            sourceCoverUrl: null,
          }) as unknown,
        }),
      );
      expect(maintenance.removeIfUnreferenced).toHaveBeenCalledWith(
        oldLocal,
        3,
      );
    });

    it('changes the platform when platformId is provided and clears the unverified flag', async () => {
      mock.game.findUnique.mockResolvedValue({ id: 3 });
      mock.platform.findUnique.mockResolvedValue({ id: 5 });
      mock.game.update.mockResolvedValue({ id: 3 });

      await service.update(3, { platformId: 5 });

      expect(mock.game.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { platformId: 5, platformUnverified: false },
        }),
      );
    });

    it('merges newly edited tracked fields into the provenance column', async () => {
      mock.game.findUnique.mockResolvedValue({
        id: 3,
        userEditedFields: '["publisher"]',
      });
      mock.game.update.mockResolvedValue({ id: 3 });

      await service.update(3, { genre: 'Metroidvania' });

      expect(mock.game.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            genre: 'Metroidvania',
            userEditedFields: '["genre","publisher"]',
          },
        }),
      );
    });

    it('clears optional fields with explicit null and records provenance', async () => {
      mock.game.findUnique.mockResolvedValue({ id: 3 });
      mock.game.update.mockResolvedValue({ id: 3 });

      // `null` is not in the static type (it only reaches the service at
      // runtime, where @IsOptional lets it through) — hence the cast.
      await service.update(3, {
        edition: null,
        releaseYear: null,
      } as unknown as UpdateGameDto);

      expect(mock.game.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            edition: null,
            releaseYear: null,
            userEditedFields: '["releaseYear"]',
          },
        }),
      );
    });
  });

  describe('enrich', () => {
    const candidate: CatalogCandidate = {
      externalId: 1036,
      title: 'Halo: Combat Evolved',
      releaseYear: 2001,
      publisher: 'Bungie',
      genre: 'Shooter',
      playerCount: 16,
      coverUrl: 'https://images.igdb.com/igdb/image/upload/t_thumb/co61gh.jpg',
      platforms: [{ igdbId: 11, name: 'Xbox', abbreviation: 'XBOX' }],
      source: 'IGDB',
      raw: { id: 1036 },
    };

    const enriched = {
      title: 'Halo: Combat Evolved',
      platformId: 3,
      edition: null,
      releaseYear: 2001,
      publisher: 'Bungie',
      genre: 'Shooter',
      playerCount: 16,
      coverUrl: '/api/covers/0123456789abcdef0123456789abcdef.jpg',
      sourceCoverUrl:
        'https://images.igdb.com/igdb/image/upload/t_thumb/co61gh.jpg',
      rawMetadata: JSON.stringify({ id: 1036 }),
      enrichedAt: new Date('2026-10-07T00:00:00.000Z'),
      source: 'IGDB' as const,
      externalId: 1036,
    };

    function gameRow(overrides: Record<string, unknown> = {}) {
      return {
        id: 5,
        title: 'Halo: Combat Evolved',
        platformId: 3,
        edition: null,
        releaseYear: null,
        publisher: null,
        genre: null,
        playerCount: null,
        coverUrl: null,
        sourceCoverUrl: null as string | null,
        rawMetadata: null,
        enrichedAt: null,
        source: 'MANUAL',
        externalId: null,
        platformUnverified: false,
        userEditedFields: null as string | null,
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
        updatedAt: new Date('2026-10-01T00:00:00.000Z'),
        platform: { id: 3, name: 'Xbox', slug: 'xbox' },
        ...overrides,
      };
    }

    it('search (no body) returns the candidate and writes nothing', async () => {
      const row = gameRow();
      mock.game.findUnique.mockResolvedValue(row);
      catalog.resolve.mockResolvedValue({ kind: 'matched', candidate });

      const result = await service.enrich(5, {});

      expect(catalog.resolve).toHaveBeenCalledWith({
        title: 'Halo: Combat Evolved',
        edition: null,
        platform: 'Xbox',
        confidence: 1,
      });
      expect(result.status).toBe('matched');
      expect(result.applied).toBe(false);
      expect(result.reason).toBeNull();
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]).toEqual({
        externalId: 1036,
        title: 'Halo: Combat Evolved',
        releaseYear: 2001,
        publisher: 'Bungie',
        genre: 'Shooter',
        playerCount: 16,
        coverUrl: PREVIEW_URL,
        platforms: [{ igdbId: 11, name: 'Xbox', abbreviation: 'XBOX' }],
        source: 'IGDB',
      });
      // The external host is replaced by a signed same-origin preview URL.
      expect(preview.previewUrl).toHaveBeenCalledWith(candidate.coverUrl);
      // The raw archive payload must never leak into a response.
      expect(result.candidates[0]).not.toHaveProperty('raw');
      const { sourceCoverUrl: _sourceCoverUrl, ...gameResponse } = row;
      expect(result.game).toEqual({
        ...gameResponse,
        coverThumbUrl: null,
        userEditedFields: [],
      });
      expect(enrichment.enrichCandidate).not.toHaveBeenCalled();
      expect(mock.game.update).not.toHaveBeenCalled();
    });

    it('apply (pick) updates the existing game in place', async () => {
      const row = gameRow();
      mock.game.findUnique.mockResolvedValue(row);
      catalog.resolve.mockResolvedValue({ kind: 'matched', candidate });
      enrichment.enrichCandidate.mockResolvedValue(enriched);
      mock.game.update.mockResolvedValue({
        ...row,
        releaseYear: 2001,
        publisher: 'Bungie',
        genre: 'Shooter',
        playerCount: 16,
        coverUrl: enriched.coverUrl,
        rawMetadata: enriched.rawMetadata,
        enrichedAt: enriched.enrichedAt,
        source: 'IGDB',
        externalId: 1036,
      });

      const result = await service.enrich(5, {
        candidate: { source: 'IGDB', externalId: 1036 },
      });

      expect(enrichment.enrichCandidate).toHaveBeenCalledWith(
        candidate,
        3,
        null,
      );
      // Exact data equality proves the protected identity fields are omitted.
      expect(mock.game.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 5 },
          data: {
            releaseYear: 2001,
            publisher: 'Bungie',
            genre: 'Shooter',
            playerCount: 16,
            coverUrl: enriched.coverUrl,
            sourceCoverUrl: enriched.sourceCoverUrl,
            source: 'IGDB',
            externalId: 1036,
            rawMetadata: enriched.rawMetadata,
            enrichedAt: enriched.enrichedAt,
          },
        }),
      );
      expect(result.status).toBe('matched');
      expect(result.applied).toBe(true);
      expect(result.game.publisher).toBe('Bungie');
      expect(result.game.externalId).toBe(1036);
      // The previous (null) cover is unchanged, so the maintenance hook is a
      // no-op.
      expect(maintenance.removeIfUnreferenced).toHaveBeenCalledWith(null, 5);
    });

    it('reports unrecognized without writing', async () => {
      const row = gameRow();
      mock.game.findUnique.mockResolvedValue(row);
      catalog.resolve.mockResolvedValue({
        kind: 'unrecognized',
        reason: 'No game matched the title in any source',
      });

      const result = await service.enrich(5, {});

      expect(result.status).toBe('unrecognized');
      expect(result.reason).toBe('No game matched the title in any source');
      expect(result.candidates).toEqual([]);
      expect(result.applied).toBe(false);
      const { sourceCoverUrl: _sourceCoverUrl, ...gameResponse } = row;
      expect(result.game).toEqual({
        ...gameResponse,
        coverThumbUrl: null,
        userEditedFields: [],
      });
      expect(mock.game.update).not.toHaveBeenCalled();
    });

    it('maps a transient resolution to 503', async () => {
      mock.game.findUnique.mockResolvedValue(gameRow());
      catalog.resolve.mockResolvedValue({
        kind: 'transient',
        reason: 'IGDB rate-limited the request',
      });

      await expect(service.enrich(5, {})).rejects.toThrow(
        new ServiceUnavailableException('IGDB rate-limited the request'),
      );
      expect(mock.game.update).not.toHaveBeenCalled();
    });

    it('maps a config_error resolution to 503', async () => {
      mock.game.findUnique.mockResolvedValue(gameRow());
      catalog.resolve.mockResolvedValue({
        kind: 'config_error',
        source: 'igdb',
        reason: 'IGDB credentials rejected',
      });

      await expect(service.enrich(5, {})).rejects.toThrow(
        new ServiceUnavailableException('IGDB credentials rejected'),
      );
      expect(mock.game.update).not.toHaveBeenCalled();
    });

    it('rejects a stale pick with 409', async () => {
      mock.game.findUnique.mockResolvedValue(gameRow());
      catalog.resolve.mockResolvedValue({ kind: 'matched', candidate });

      await expect(
        service.enrich(5, { candidate: { source: 'IGDB', externalId: 999 } }),
      ).rejects.toThrow(
        new ConflictException(
          'The selected candidate is no longer available; run the search again',
        ),
      );
      expect(enrichment.enrichCandidate).not.toHaveBeenCalled();
      expect(mock.game.update).not.toHaveBeenCalled();
    });

    it('is idempotent: a second identical apply writes nothing', async () => {
      const row = gameRow({
        releaseYear: 2001,
        publisher: 'Bungie',
        genre: 'Shooter',
        playerCount: 16,
        coverUrl: enriched.coverUrl,
        sourceCoverUrl: enriched.sourceCoverUrl,
        rawMetadata: enriched.rawMetadata,
        enrichedAt: enriched.enrichedAt,
        source: 'IGDB',
        externalId: 1036,
      });
      mock.game.findUnique.mockResolvedValue(row);
      catalog.resolve.mockResolvedValue({ kind: 'matched', candidate });
      enrichment.enrichCandidate.mockResolvedValue(enriched);

      const result = await service.enrich(5, {
        candidate: { source: 'IGDB', externalId: 1036 },
      });

      expect(result.applied).toBe(false);
      expect(mock.game.update).not.toHaveBeenCalled();
      expect(result.game.externalId).toBe(1036);
    });

    it('never overwrites a hand-edited field', async () => {
      const row = gameRow({ userEditedFields: '["publisher"]' });
      mock.game.findUnique.mockResolvedValue(row);
      catalog.resolve.mockResolvedValue({ kind: 'matched', candidate });
      enrichment.enrichCandidate.mockResolvedValue(enriched);
      mock.game.update.mockResolvedValue({
        ...row,
        releaseYear: 2001,
        genre: 'Shooter',
        playerCount: 16,
        coverUrl: enriched.coverUrl,
        rawMetadata: enriched.rawMetadata,
        enrichedAt: enriched.enrichedAt,
        source: 'IGDB',
        externalId: 1036,
      });

      await service.enrich(5, {
        candidate: { source: 'IGDB', externalId: 1036 },
      });

      // Exact data equality proves the hand-edited publisher is omitted.
      expect(mock.game.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 5 },
          data: {
            releaseYear: 2001,
            genre: 'Shooter',
            playerCount: 16,
            coverUrl: enriched.coverUrl,
            sourceCoverUrl: enriched.sourceCoverUrl,
            source: 'IGDB',
            externalId: 1036,
            rawMetadata: enriched.rawMetadata,
            enrichedAt: enriched.enrichedAt,
          },
        }),
      );
    });

    it('removes the downloaded candidate cover when provenance blocks adopting it', async () => {
      const oldCover = `/api/covers/${'b'.repeat(32)}.jpg`;
      const row = gameRow({
        coverUrl: oldCover,
        userEditedFields: '["coverUrl"]',
      });
      mock.game.findUnique.mockResolvedValue(row);
      catalog.resolve.mockResolvedValue({ kind: 'matched', candidate });
      enrichment.enrichCandidate.mockResolvedValue(enriched);
      mock.game.update.mockResolvedValue({
        ...row,
        releaseYear: 2001,
        publisher: 'Bungie',
        genre: 'Shooter',
        playerCount: 16,
      });

      await service.enrich(5, {
        candidate: { source: 'IGDB', externalId: 1036 },
      });

      // The hand-edited cover is not written, so the downloaded candidate file
      // is orphaned and must be removed (ref-counted). Exact data equality
      // proves `coverUrl`/`sourceCoverUrl` were omitted.
      expect(mock.game.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 5 },
          data: {
            releaseYear: 2001,
            publisher: 'Bungie',
            genre: 'Shooter',
            playerCount: 16,
            source: 'IGDB',
            externalId: 1036,
            rawMetadata: enriched.rawMetadata,
            enrichedAt: enriched.enrichedAt,
          },
        }),
      );
      expect(maintenance.removeIfUnreferenced).toHaveBeenCalledWith(
        enriched.coverUrl,
        5,
      );
      // The still-referenced existing cover is never removed.
      expect(maintenance.removeIfUnreferenced).not.toHaveBeenCalledWith(
        oldCover,
        5,
      );
    });

    it('throws 404 for an unknown game', async () => {
      mock.game.findUnique.mockResolvedValue(null);

      await expect(service.enrich(7, {})).rejects.toThrow(
        new NotFoundException('Game with id 7 not found'),
      );
      expect(catalog.resolve).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('throws 404 for an unknown game', async () => {
      mock.game.findUnique.mockResolvedValue(null);

      await expect(service.remove(7)).rejects.toThrow(
        new NotFoundException('Game with id 7 not found'),
      );
      expect(mock.game.delete).not.toHaveBeenCalled();
    });

    it('deletes the game when it exists', async () => {
      const coverUrl = `/api/covers/${'f'.repeat(32)}.jpg`;
      mock.game.findUnique.mockResolvedValue({ id: 3, coverUrl });
      mock.game.delete.mockResolvedValue({ id: 3 });

      await service.remove(3);

      expect(mock.game.delete).toHaveBeenCalledWith({ where: { id: 3 } });
      expect(maintenance.removeIfUnreferenced).toHaveBeenCalledWith(coverUrl);
    });
  });
});
