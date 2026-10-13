import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../src/generated/prisma/client';
import { PlatformsService } from '../../src/platforms/platforms.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { testId } from '../helpers/ids';

interface PlatformsPrismaMock {
  platform: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  platformAlias: {
    findUnique: jest.Mock;
    createMany: jest.Mock;
    updateMany: jest.Mock;
  };
  game: {
    groupBy: jest.Mock;
    count: jest.Mock;
    updateMany: jest.Mock;
  };
  $transaction: jest.Mock;
}

function createService(): {
  service: PlatformsService;
  mock: PlatformsPrismaMock;
} {
  const mock: PlatformsPrismaMock = {
    platform: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    platformAlias: {
      findUnique: jest.fn(),
      createMany: jest.fn(),
      updateMany: jest.fn(),
    },
    game: {
      groupBy: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  // Interactive transactions run the callback against the same mock as `tx`.
  mock.$transaction.mockImplementation(
    (callback: (tx: PlatformsPrismaMock) => unknown) => callback(mock),
  );
  return {
    service: new PlatformsService(mock as unknown as PrismaService),
    mock,
  };
}

/** Prisma 7 known-request error (P2002/P2025/P2003) for the mock. */
function knownError(
  code: string,
  meta?: Record<string, unknown>,
): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('mock error', {
    code,
    clientVersion: '7.10.0',
    meta,
  });
}

const PS5 = {
  id: testId(1),
  name: 'PlayStation 5',
  abbreviation: null,
  alternativeName: null,
  igdbId: null,
  slug: 'playstation-5',
  addedByImport: false,
  hidden: false,
};

describe('PlatformsService (unit)', () => {
  let service: PlatformsService;
  let mock: PlatformsPrismaMock;

  beforeEach(() => {
    ({ service, mock } = createService());
  });

  describe('list', () => {
    it('joins one groupBy count map (no N+1) and defaults missing counts to 0', async () => {
      const pc = { ...PS5, id: testId(2), name: 'PC', slug: 'pc' };
      mock.platform.findMany.mockResolvedValue([PS5, pc]);
      mock.game.groupBy.mockResolvedValue([
        { platformId: testId(1), _count: { _all: 3 } },
      ]);

      const result = await service.list();

      expect(mock.platform.findMany).toHaveBeenCalledWith({
        orderBy: [{ addedByImport: 'desc' }, { name: 'asc' }],
      });
      expect(mock.game.groupBy).toHaveBeenCalledWith({
        by: ['platformId'],
        _count: { _all: true },
      });
      expect(result).toEqual([
        { ...PS5, gameCount: 3 },
        { ...pc, gameCount: 0 },
      ]);
    });
  });

  describe('findOne', () => {
    it('returns the platform with its game count', async () => {
      mock.platform.findUnique.mockResolvedValue(PS5);
      mock.game.count.mockResolvedValue(5);

      const result = await service.findOne(testId(1));

      expect(mock.platform.findUnique).toHaveBeenCalledWith({
        where: { id: testId(1) },
      });
      expect(mock.game.count).toHaveBeenCalledWith({
        where: { platformId: testId(1) },
      });
      expect(result).toEqual({ ...PS5, gameCount: 5 });
    });

    it('throws 404 for an unknown id', async () => {
      mock.platform.findUnique.mockResolvedValue(null);
      mock.game.count.mockResolvedValue(0);

      await expect(service.findOne(testId(9))).rejects.toThrow(
        new NotFoundException(`Platform with id ${testId(9)} not found`),
      );
    });
  });

  describe('listMatchCandidates', () => {
    it('selects matcher fields + aliases, oldest id first, and maps aliases to strings', async () => {
      mock.platform.findMany.mockResolvedValue([
        {
          id: testId(1),
          name: 'PC',
          abbreviation: null,
          alternativeName: null,
          aliases: [{ name: 'Windows PC' }],
        },
      ]);

      await expect(service.listMatchCandidates()).resolves.toEqual([
        {
          id: testId(1),
          name: 'PC',
          abbreviation: null,
          alternativeName: null,
          aliases: ['Windows PC'],
        },
      ]);
      expect(mock.platform.findMany).toHaveBeenCalledWith({
        orderBy: { id: 'asc' },
        select: {
          id: true,
          name: true,
          abbreviation: true,
          alternativeName: true,
          aliases: { select: { name: true } },
        },
      });
    });
  });

  describe('createCanonical', () => {
    it('reserves a slug and stores the canonical fields', async () => {
      mock.platform.findUnique.mockResolvedValue(null);
      const created = {
        id: testId(1),
        name: 'PlayStation 5',
        abbreviation: 'PS5',
        alternativeName: null,
      };
      mock.platform.create.mockResolvedValue(created);

      const result = await service.createCanonical({
        name: 'PlayStation 5',
        abbreviation: 'PS5',
        alternativeName: null,
        platformFamily: 1,
        igdbId: 130,
      });

      expect(mock.platform.findUnique).toHaveBeenCalledWith({
        where: { slug: 'playstation-5' },
        select: { id: true },
      });
      expect(mock.platform.create).toHaveBeenCalledWith({
        data: {
          name: 'PlayStation 5',
          slug: 'playstation-5',
          abbreviation: 'PS5',
          alternativeName: null,
          platformFamily: 1,
          igdbId: 130,
        },
        select: {
          id: true,
          name: true,
          abbreviation: true,
          alternativeName: true,
        },
      });
      expect(result).toEqual(created);
    });
  });

  describe('updateCanonical', () => {
    const input = {
      name: 'PlayStation 5',
      abbreviation: 'PS5',
      alternativeName: null,
      platformFamily: 1,
      igdbId: 130,
    };

    it('returns false without writing when the platform is missing', async () => {
      mock.platform.findUnique.mockResolvedValue(null);

      await expect(service.updateCanonical(testId(1), input)).resolves.toBe(
        false,
      );
      expect(mock.platform.update).not.toHaveBeenCalled();
    });

    it('returns false without writing when every field already matches', async () => {
      mock.platform.findUnique.mockResolvedValue({
        abbreviation: 'PS5',
        alternativeName: null,
        platformFamily: 1,
        igdbId: 130,
      });

      await expect(service.updateCanonical(testId(1), input)).resolves.toBe(
        false,
      );
      expect(mock.platform.update).not.toHaveBeenCalled();
    });

    it('updates only the canonical fields and returns true when changed', async () => {
      mock.platform.findUnique.mockResolvedValue({
        abbreviation: null,
        alternativeName: null,
        platformFamily: null,
        igdbId: null,
      });
      mock.platform.update.mockResolvedValue({});

      await expect(service.updateCanonical(testId(1), input)).resolves.toBe(
        true,
      );
      expect(mock.platform.update).toHaveBeenCalledWith({
        where: { id: testId(1) },
        data: {
          abbreviation: 'PS5',
          alternativeName: null,
          platformFamily: 1,
          igdbId: 130,
        },
      });
    });

    it('restores a hidden reference platform even when every field matches', async () => {
      mock.platform.findUnique.mockResolvedValue({
        abbreviation: 'PS5',
        alternativeName: null,
        platformFamily: 1,
        igdbId: 130,
        hidden: true,
      });
      mock.platform.update.mockResolvedValue({});

      await expect(service.updateCanonical(testId(1), input)).resolves.toBe(
        true,
      );
      expect(mock.platform.update).toHaveBeenCalledWith({
        where: { id: testId(1) },
        data: {
          abbreviation: 'PS5',
          alternativeName: null,
          platformFamily: 1,
          igdbId: 130,
          hidden: false,
        },
      });
    });
  });

  describe('create', () => {
    it('rejects a blank (whitespace-only) name with 400', async () => {
      await expect(service.create({ name: '   ' })).rejects.toThrow(
        new BadRequestException('name must not be blank'),
      );
      expect(mock.platform.findUnique).not.toHaveBeenCalled();
    });

    it('slugifies the name and creates with gameCount 0', async () => {
      mock.platform.findUnique.mockResolvedValue(null);
      const created = { ...PS5 };
      mock.platform.create.mockResolvedValue(created);

      const result = await service.create({ name: 'PlayStation 5' });

      expect(mock.platform.findUnique).toHaveBeenCalledWith({
        where: { slug: 'playstation-5' },
        select: { id: true },
      });
      expect(mock.platform.create).toHaveBeenCalledWith({
        data: { name: 'PlayStation 5', slug: 'playstation-5' },
      });
      expect(result).toEqual({ ...created, gameCount: 0 });
    });

    it('strips diacritics when slugifying unicode names', async () => {
      mock.platform.findUnique.mockResolvedValue(null);
      mock.platform.create.mockResolvedValue({
        ...PS5,
        name: 'Święta',
        slug: 'swieta',
      });

      await service.create({ name: 'Święta' });

      expect(mock.platform.findUnique).toHaveBeenCalledWith({
        where: { slug: 'swieta' },
        select: { id: true },
      });
    });

    it('falls back to the "platform" slug when slugify produces nothing', async () => {
      mock.platform.findUnique.mockResolvedValue(null);
      mock.platform.create.mockResolvedValue({
        ...PS5,
        name: '!!',
        slug: 'platform',
      });

      await service.create({ name: '!!' });

      expect(mock.platform.findUnique).toHaveBeenCalledWith({
        where: { slug: 'platform' },
        select: { id: true },
      });
    });

    it('maps a P2002 on the name unique to 409 (no retry)', async () => {
      mock.platform.findUnique.mockResolvedValue(null);
      mock.platform.create.mockRejectedValue(
        knownError('P2002', { target: ['name'] }),
      );

      await expect(service.create({ name: 'PlayStation 5' })).rejects.toThrow(
        new ConflictException(
          'A platform named "PlayStation 5" already exists',
        ),
      );
      expect(mock.platform.create).toHaveBeenCalledTimes(1);
    });

    it('maps a P2002 on the name unique (driver-adapter shape) to 409', async () => {
      mock.platform.findUnique.mockResolvedValue(null);
      mock.platform.create.mockRejectedValue(
        knownError('P2002', {
          driverAdapterError: {
            cause: { constraint: { index: 'platforms_name_key' } },
          },
        }),
      );

      await expect(service.create({ name: 'PlayStation 5' })).rejects.toThrow(
        ConflictException,
      );
      expect(mock.platform.create).toHaveBeenCalledTimes(1);
    });

    it('retries with a suffixed slug on a P2002 on the slug unique', async () => {
      mock.platform.findUnique
        .mockResolvedValueOnce(null) // attempt 1: base slug looked free
        .mockResolvedValueOnce({ id: testId(9) }) // attempt 2: base slug now taken
        .mockResolvedValueOnce(null); // attempt 2: base-2 is free
      const created = { ...PS5, slug: 'playstation-5-2' };
      mock.platform.create
        .mockRejectedValueOnce(knownError('P2002', { target: ['slug'] }))
        .mockResolvedValueOnce(created);

      const result = await service.create({ name: 'PlayStation 5' });

      expect(mock.platform.create).toHaveBeenCalledTimes(2);
      expect(mock.platform.create).toHaveBeenNthCalledWith(2, {
        data: { name: 'PlayStation 5', slug: 'playstation-5-2' },
      });
      expect(result).toEqual({ ...created, gameCount: 0 });
    });

    it('retries on a slug P2002 reported via the driver-adapter shape', async () => {
      mock.platform.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: testId(9) })
        .mockResolvedValueOnce(null);
      const created = { ...PS5, slug: 'playstation-5-2' };
      mock.platform.create
        .mockRejectedValueOnce(
          knownError('P2002', {
            driverAdapterError: {
              cause: { constraint: { index: 'platforms_slug_key' } },
            },
          }),
        )
        .mockResolvedValueOnce(created);

      const result = await service.create({ name: 'PlayStation 5' });

      expect(mock.platform.create).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ ...created, gameCount: 0 });
    });

    it('gives up after 3 attempts on a persistent slug race', async () => {
      mock.platform.findUnique.mockResolvedValue(null);
      const slugError = knownError('P2002', { target: ['slug'] });
      mock.platform.create.mockRejectedValue(slugError);

      await expect(service.create({ name: 'PlayStation 5' })).rejects.toBe(
        slugError,
      );
      expect(mock.platform.create).toHaveBeenCalledTimes(3);
    });

    it('rejects a name that is already an alias of another platform with 409', async () => {
      mock.platformAlias.findUnique.mockResolvedValue({
        platformId: testId(7),
      });

      await expect(service.create({ name: 'PlayStaton 5' })).rejects.toThrow(
        ConflictException,
      );
      expect(mock.platform.create).not.toHaveBeenCalled();
    });
  });

  describe('createFromImport', () => {
    it('creates a flagged platform and returns its id', async () => {
      mock.platformAlias.findUnique.mockResolvedValue(null);
      mock.platform.findUnique.mockResolvedValue(null);
      mock.platform.create.mockResolvedValue({ id: testId(42) });

      await expect(service.createFromImport('PlayStaton 5')).resolves.toBe(
        testId(42),
      );
      expect(mock.platform.create).toHaveBeenCalledWith({
        data: {
          name: 'PlayStaton 5',
          slug: 'playstaton-5',
          addedByImport: true,
        },
        select: { id: true },
      });
    });

    it('returns the alias owner id without creating', async () => {
      mock.platformAlias.findUnique.mockResolvedValue({
        platformId: testId(9),
      });

      await expect(service.createFromImport('PlayStaton 5')).resolves.toBe(
        testId(9),
      );
      expect(mock.platform.create).not.toHaveBeenCalled();
    });

    it('re-fetches the existing row on a name race', async () => {
      mock.platformAlias.findUnique.mockResolvedValue(null);
      mock.platform.findUnique.mockResolvedValue(null);
      mock.platform.create.mockRejectedValue(
        knownError('P2002', { target: ['name'] }),
      );
      mock.platform.findFirst.mockResolvedValue({ id: testId(5) });

      await expect(service.createFromImport('PlayStaton 5')).resolves.toBe(
        testId(5),
      );
      expect(mock.platform.findFirst).toHaveBeenCalledWith({
        where: { name: 'PlayStaton 5' },
        select: { id: true },
      });
    });

    it('retries the slug on a slug race', async () => {
      mock.platformAlias.findUnique.mockResolvedValue(null);
      mock.platform.findUnique
        .mockResolvedValueOnce(null) // attempt 1 base slug free
        .mockResolvedValueOnce({ id: testId(9) }) // attempt 2 base taken
        .mockResolvedValueOnce(null); // attempt 2 base-2 free
      mock.platform.create
        .mockRejectedValueOnce(knownError('P2002', { target: ['slug'] }))
        .mockResolvedValueOnce({ id: testId(42) });

      await expect(service.createFromImport('PlayStaton 5')).resolves.toBe(
        testId(42),
      );
      expect(mock.platform.create).toHaveBeenCalledTimes(2);
    });

    it('rejects a blank name defensively', async () => {
      await expect(service.createFromImport('   ')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('rename', () => {
    it('rejects a blank (whitespace-only) name with 400', async () => {
      await expect(service.rename(testId(1), { name: '  ' })).rejects.toThrow(
        new BadRequestException('name must not be blank'),
      );
      expect(mock.platform.findUnique).not.toHaveBeenCalled();
    });

    it('throws 404 for an unknown platform', async () => {
      mock.platform.findUnique.mockResolvedValue(null);

      await expect(service.rename(testId(9), { name: 'New' })).rejects.toThrow(
        new NotFoundException(`Platform with id ${testId(9)} not found`),
      );
      expect(mock.platform.update).not.toHaveBeenCalled();
    });

    it('renames and returns the fresh game count', async () => {
      mock.platform.findUnique.mockResolvedValue({
        id: testId(1),
        name: 'PlayStation 5',
      });
      const updated = { ...PS5, name: 'PlayStation 5 Pro' };
      mock.platform.update.mockResolvedValue(updated);
      mock.game.count.mockResolvedValue(4);

      const result = await service.rename(testId(1), {
        name: 'PlayStation 5 Pro',
      });

      expect(mock.platform.update).toHaveBeenCalledWith({
        where: { id: testId(1) },
        data: { name: 'PlayStation 5 Pro' },
      });
      expect(result).toEqual({ ...updated, gameCount: 4 });
    });

    it('only sends canonical fields when the name is unchanged', async () => {
      mock.platform.findUnique.mockResolvedValue({
        id: testId(1),
        name: 'PS5',
      });
      const updated = { ...PS5, name: 'PS5', abbreviation: 'PS5', igdbId: 130 };
      mock.platform.update.mockResolvedValue(updated);
      mock.game.count.mockResolvedValue(0);

      await service.rename(testId(1), {
        name: 'PS5',
        abbreviation: 'PS5',
        alternativeName: null,
        igdbId: 130,
      });

      expect(mock.platform.update).toHaveBeenCalledWith({
        where: { id: testId(1) },
        data: { abbreviation: 'PS5', alternativeName: null, igdbId: 130 },
      });
    });

    it('maps a P2002 on the name unique to 409', async () => {
      mock.platform.findUnique.mockResolvedValue({
        id: testId(1),
        name: 'Old',
      });
      mock.platform.update.mockRejectedValue(
        knownError('P2002', { target: ['name'] }),
      );

      await expect(
        service.rename(testId(1), { name: 'Taken' }),
      ).rejects.toThrow(
        new ConflictException('A platform named "Taken" already exists'),
      );
    });

    it('maps P2025 (deleted mid-flight) to 404', async () => {
      mock.platform.findUnique.mockResolvedValue({
        id: testId(1),
        name: 'Old',
      });
      mock.platform.update.mockRejectedValue(knownError('P2025'));

      await expect(service.rename(testId(1), { name: 'New' })).rejects.toThrow(
        new NotFoundException(`Platform with id ${testId(1)} not found`),
      );
    });

    it('writes the previous name as a normalized alias', async () => {
      mock.platform.findUnique.mockResolvedValue({
        id: testId(1),
        name: 'PlayStaton 5',
      });
      mock.platform.update.mockResolvedValue({ ...PS5 });
      mock.game.count.mockResolvedValue(0);

      await service.rename(testId(1), { name: 'PlayStation 5' });

      expect(mock.platformAlias.createMany).toHaveBeenCalledWith({
        data: [
          {
            platformId: testId(1),
            name: 'PlayStaton 5',
            normalizedName: 'playstaton 5',
          },
        ],
        skipDuplicates: true,
      });
    });

    it('does not write an alias when the name is unchanged', async () => {
      mock.platform.findUnique.mockResolvedValue({
        id: testId(1),
        name: 'PS5',
      });
      mock.platform.update.mockResolvedValue({ ...PS5 });
      mock.game.count.mockResolvedValue(0);

      await service.rename(testId(1), { name: 'PS5' });

      expect(mock.platformAlias.createMany).not.toHaveBeenCalled();
    });

    it('rejects a new name owned by another alias with 409', async () => {
      mock.platform.findUnique.mockResolvedValue({
        id: testId(1),
        name: 'Old',
      });
      mock.platformAlias.findUnique.mockResolvedValue({
        platformId: testId(99),
      });

      await expect(
        service.rename(testId(1), { name: 'Taken' }),
      ).rejects.toThrow(ConflictException);
      expect(mock.platform.update).not.toHaveBeenCalled();
    });

    it('allows a rename to an alias already owned by the same platform', async () => {
      mock.platform.findUnique.mockResolvedValue({
        id: testId(1),
        name: 'Old',
      });
      mock.platformAlias.findUnique.mockResolvedValue({
        platformId: testId(1),
      });
      mock.platform.update.mockResolvedValue({ ...PS5 });
      mock.game.count.mockResolvedValue(0);

      await expect(service.rename(testId(1), { name: 'New' })).resolves.toEqual(
        {
          ...PS5,
          gameCount: 0,
        },
      );
    });

    it('toggles hidden through the same update', async () => {
      mock.platform.findUnique.mockResolvedValue({
        id: testId(1),
        name: 'PS5',
      });
      mock.platform.update.mockResolvedValue({ ...PS5, hidden: true });
      mock.game.count.mockResolvedValue(0);

      await service.rename(testId(1), { name: 'PS5', hidden: false });

      expect(mock.platform.update).toHaveBeenCalledWith({
        where: { id: testId(1) },
        data: { hidden: false },
      });
    });
  });

  describe('confirm', () => {
    it('clears addedByImport and returns the model', async () => {
      mock.platform.update.mockResolvedValue({ ...PS5, addedByImport: false });
      mock.game.count.mockResolvedValue(3);

      await expect(service.confirm(testId(1))).resolves.toEqual({
        ...PS5,
        addedByImport: false,
        gameCount: 3,
      });
      expect(mock.platform.update).toHaveBeenCalledWith({
        where: { id: testId(1) },
        data: { addedByImport: false },
      });
    });

    it('maps P2025 to 404', async () => {
      mock.platform.update.mockRejectedValue(knownError('P2025'));

      await expect(service.confirm(testId(1))).rejects.toThrow(
        new NotFoundException(`Platform with id ${testId(1)} not found`),
      );
    });
  });

  describe('merge', () => {
    it('rejects merging into itself with 400', async () => {
      await expect(service.merge(testId(1), testId(1))).rejects.toThrow(
        BadRequestException,
      );
      expect(mock.platform.findUnique).not.toHaveBeenCalled();
    });

    it('throws 404 when the source is missing', async () => {
      mock.platform.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: testId(2) });

      await expect(service.merge(testId(1), testId(2))).rejects.toThrow(
        new NotFoundException(`Platform with id ${testId(1)} not found`),
      );
    });

    it('throws 404 when the target is missing', async () => {
      mock.platform.findUnique
        .mockResolvedValueOnce({
          id: testId(1),
          name: 'A',
          abbreviation: null,
          alternativeName: null,
        })
        .mockResolvedValueOnce(null);

      await expect(service.merge(testId(1), testId(2))).rejects.toThrow(
        new NotFoundException(`Platform with id ${testId(2)} not found`),
      );
    });

    it('moves games, transfers aliases, adds name keys, deletes the source', async () => {
      mock.platform.findUnique
        .mockResolvedValueOnce({
          id: testId(1),
          name: 'PlayStaton 5',
          abbreviation: 'PS5',
          alternativeName: null,
        })
        .mockResolvedValueOnce({ id: testId(2) })
        .mockResolvedValueOnce({ ...PS5, id: testId(2) });
      mock.game.updateMany.mockResolvedValue({ count: 2 });
      mock.platformAlias.updateMany.mockResolvedValue({ count: 1 });
      mock.platformAlias.createMany.mockResolvedValue({ count: 2 });
      mock.platform.delete.mockResolvedValue({});
      mock.game.count.mockResolvedValue(4);

      const result = await service.merge(testId(1), testId(2));

      expect(mock.game.updateMany).toHaveBeenCalledWith({
        where: { platformId: testId(1) },
        data: { platformId: testId(2) },
      });
      expect(mock.platformAlias.updateMany).toHaveBeenCalledWith({
        where: { platformId: testId(1) },
        data: { platformId: testId(2) },
      });
      expect(mock.platformAlias.createMany).toHaveBeenCalledWith({
        data: [
          {
            platformId: testId(2),
            name: 'PlayStaton 5',
            normalizedName: 'playstaton 5',
          },
          { platformId: testId(2), name: 'PS5', normalizedName: 'ps5' },
        ],
        skipDuplicates: true,
      });
      expect(mock.platform.delete).toHaveBeenCalledWith({
        where: { id: testId(1) },
      });
      expect(result).toEqual({ ...PS5, id: testId(2), gameCount: 4 });
    });

    it('maps a P2003 to 409', async () => {
      mock.platform.findUnique
        .mockResolvedValueOnce({
          id: testId(1),
          name: 'A',
          abbreviation: null,
          alternativeName: null,
        })
        .mockResolvedValueOnce({ id: testId(2) });
      mock.game.updateMany.mockRejectedValue(knownError('P2003'));

      await expect(service.merge(testId(1), testId(2))).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('remove', () => {
    it('throws 404 for an unknown platform', async () => {
      mock.platform.findUnique.mockResolvedValue(null);

      await expect(service.remove(testId(9))).rejects.toThrow(
        new NotFoundException(`Platform with id ${testId(9)} not found`),
      );
      expect(mock.game.count).not.toHaveBeenCalled();
    });

    it('refuses with 409 while games reference the platform', async () => {
      mock.platform.findUnique.mockResolvedValue({
        id: testId(1),
        igdbId: null,
      });
      mock.game.count.mockResolvedValue(2);

      await expect(service.remove(testId(1))).rejects.toThrow(
        new ConflictException(
          `Platform with id ${testId(1)} has 2 game(s); reassign or delete them before deleting the platform`,
        ),
      );
      expect(mock.platform.delete).not.toHaveBeenCalled();
    });

    it('hides (never deletes) a reference platform without games', async () => {
      mock.platform.findUnique.mockResolvedValue({
        id: testId(1),
        igdbId: 130,
      });
      mock.game.count.mockResolvedValue(0);
      mock.platform.update.mockResolvedValue({
        ...PS5,
        igdbId: 130,
        hidden: true,
      });

      await service.remove(testId(1));

      expect(mock.platform.update).toHaveBeenCalledWith({
        where: { id: testId(1) },
        data: { hidden: true },
      });
      expect(mock.platform.delete).not.toHaveBeenCalled();
    });

    it('deletes a custom/import platform without games', async () => {
      mock.platform.findUnique.mockResolvedValue({
        id: testId(1),
        igdbId: null,
      });
      mock.game.count.mockResolvedValue(0);
      mock.platform.delete.mockResolvedValue(PS5);

      await service.remove(testId(1));

      expect(mock.platform.delete).toHaveBeenCalledWith({
        where: { id: testId(1) },
      });
      expect(mock.platform.update).not.toHaveBeenCalled();
    });

    it('maps a P2003 (FK race) to 409', async () => {
      mock.platform.findUnique.mockResolvedValue({
        id: testId(1),
        igdbId: null,
      });
      mock.game.count.mockResolvedValue(0);
      mock.platform.delete.mockRejectedValue(knownError('P2003'));

      await expect(service.remove(testId(1))).rejects.toThrow(
        new ConflictException(
          `Platform with id ${testId(1)} has games; reassign or delete them before deleting the platform`,
        ),
      );
    });

    it('maps P2025 (deleted mid-flight) to 404', async () => {
      mock.platform.findUnique.mockResolvedValue({
        id: testId(1),
        igdbId: null,
      });
      mock.game.count.mockResolvedValue(0);
      mock.platform.delete.mockRejectedValue(knownError('P2025'));

      await expect(service.remove(testId(1))).rejects.toThrow(
        new NotFoundException(`Platform with id ${testId(1)} not found`),
      );
    });
  });
});
