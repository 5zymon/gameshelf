import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { CreateGameDto } from '../../src/games/dto/create-game.dto';
import type { ListGamesQueryDto } from '../../src/games/dto/list-games-query.dto';
import type { UpdateGameDto } from '../../src/games/dto/update-game.dto';
import { GamesService } from '../../src/games/games.service';
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

function createService(): { service: GamesService; mock: GamesPrismaMock } {
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
  return { service: new GamesService(mock as unknown as PrismaService), mock };
}

describe('GamesService (unit)', () => {
  let service: GamesService;
  let mock: GamesPrismaMock;

  beforeEach(() => {
    ({ service, mock } = createService());
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
      expect(result).toBe(game);
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
        },
        include: { platform: { select: PLATFORM_SELECT } },
      });
      expect(result).toBe(created);
    });

    it('passes every provided field through', async () => {
      mock.platform.findUnique.mockResolvedValue({ id: 2 });
      const created = { id: 1 };
      mock.game.create.mockResolvedValue(created);
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

      expect(mock.game.create).toHaveBeenCalledWith({
        data: dto,
        include: { platform: { select: PLATFORM_SELECT } },
      });
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
      expect(result).toBe(updated);
    });

    it('changes the platform when platformId is provided', async () => {
      mock.game.findUnique.mockResolvedValue({ id: 3 });
      mock.platform.findUnique.mockResolvedValue({ id: 5 });
      mock.game.update.mockResolvedValue({ id: 3 });

      await service.update(3, { platformId: 5 });

      expect(mock.game.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { platformId: 5 } }),
      );
    });

    it('clears optional fields with explicit null', async () => {
      mock.game.findUnique.mockResolvedValue({ id: 3 });
      mock.game.update.mockResolvedValue({ id: 3 });

      // `null` is not in the static type (it only reaches the service at
      // runtime, where @IsOptional lets it through) — hence the cast.
      await service.update(3, {
        edition: null,
        releaseYear: null,
      } as unknown as UpdateGameDto);

      expect(mock.game.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { edition: null, releaseYear: null } }),
      );
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
      mock.game.findUnique.mockResolvedValue({ id: 3 });
      mock.game.delete.mockResolvedValue({ id: 3 });

      await service.remove(3);

      expect(mock.game.delete).toHaveBeenCalledWith({ where: { id: 3 } });
    });
  });
});
