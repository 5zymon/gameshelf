import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../src/generated/prisma/client';
import { PlatformsService } from '../../src/platforms/platforms.service';
import type { PrismaService } from '../../src/prisma/prisma.service';

interface PlatformsPrismaMock {
  platform: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  game: {
    groupBy: jest.Mock;
    count: jest.Mock;
  };
}

function createService(): {
  service: PlatformsService;
  mock: PlatformsPrismaMock;
} {
  const mock: PlatformsPrismaMock = {
    platform: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    game: {
      groupBy: jest.fn(),
      count: jest.fn(),
    },
  };
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
  id: 1,
  name: 'PlayStation 5',
  abbreviation: null,
  alternativeName: null,
  igdbId: null,
  slug: 'playstation-5',
};

describe('PlatformsService (unit)', () => {
  let service: PlatformsService;
  let mock: PlatformsPrismaMock;

  beforeEach(() => {
    ({ service, mock } = createService());
  });

  describe('list', () => {
    it('joins one groupBy count map (no N+1) and defaults missing counts to 0', async () => {
      const pc = { ...PS5, id: 2, name: 'PC', slug: 'pc' };
      mock.platform.findMany.mockResolvedValue([PS5, pc]);
      mock.game.groupBy.mockResolvedValue([
        { platformId: 1, _count: { _all: 3 } },
      ]);

      const result = await service.list();

      expect(mock.platform.findMany).toHaveBeenCalledWith({
        orderBy: { name: 'asc' },
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

      const result = await service.findOne(1);

      expect(mock.platform.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
      });
      expect(mock.game.count).toHaveBeenCalledWith({
        where: { platformId: 1 },
      });
      expect(result).toEqual({ ...PS5, gameCount: 5 });
    });

    it('throws 404 for an unknown id', async () => {
      mock.platform.findUnique.mockResolvedValue(null);
      mock.game.count.mockResolvedValue(0);

      await expect(service.findOne(9)).rejects.toThrow(
        new NotFoundException('Platform with id 9 not found'),
      );
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
        .mockResolvedValueOnce({ id: 9 }) // attempt 2: base slug now taken
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
        .mockResolvedValueOnce({ id: 9 })
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
  });

  describe('rename', () => {
    it('rejects a blank (whitespace-only) name with 400', async () => {
      await expect(service.rename(1, { name: '  ' })).rejects.toThrow(
        new BadRequestException('name must not be blank'),
      );
      expect(mock.platform.findUnique).not.toHaveBeenCalled();
    });

    it('throws 404 for an unknown platform', async () => {
      mock.platform.findUnique.mockResolvedValue(null);

      await expect(service.rename(9, { name: 'New' })).rejects.toThrow(
        new NotFoundException('Platform with id 9 not found'),
      );
      expect(mock.platform.update).not.toHaveBeenCalled();
    });

    it('renames and returns the fresh game count', async () => {
      mock.platform.findUnique.mockResolvedValue({
        id: 1,
        name: 'PlayStation 5',
      });
      const updated = { ...PS5, name: 'PlayStation 5 Pro' };
      mock.platform.update.mockResolvedValue(updated);
      mock.game.count.mockResolvedValue(4);

      const result = await service.rename(1, { name: 'PlayStation 5 Pro' });

      expect(mock.platform.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { name: 'PlayStation 5 Pro' },
      });
      expect(result).toEqual({ ...updated, gameCount: 4 });
    });

    it('only sends canonical fields when the name is unchanged', async () => {
      mock.platform.findUnique.mockResolvedValue({ id: 1, name: 'PS5' });
      const updated = { ...PS5, name: 'PS5', abbreviation: 'PS5', igdbId: 130 };
      mock.platform.update.mockResolvedValue(updated);
      mock.game.count.mockResolvedValue(0);

      await service.rename(1, {
        name: 'PS5',
        abbreviation: 'PS5',
        alternativeName: null,
        igdbId: 130,
      });

      expect(mock.platform.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { abbreviation: 'PS5', alternativeName: null, igdbId: 130 },
      });
    });

    it('maps a P2002 on the name unique to 409', async () => {
      mock.platform.findUnique.mockResolvedValue({ id: 1, name: 'Old' });
      mock.platform.update.mockRejectedValue(
        knownError('P2002', { target: ['name'] }),
      );

      await expect(service.rename(1, { name: 'Taken' })).rejects.toThrow(
        new ConflictException('A platform named "Taken" already exists'),
      );
    });

    it('maps P2025 (deleted mid-flight) to 404', async () => {
      mock.platform.findUnique.mockResolvedValue({ id: 1, name: 'Old' });
      mock.platform.update.mockRejectedValue(knownError('P2025'));

      await expect(service.rename(1, { name: 'New' })).rejects.toThrow(
        new NotFoundException('Platform with id 1 not found'),
      );
    });
  });

  describe('remove', () => {
    it('throws 404 for an unknown platform', async () => {
      mock.platform.findUnique.mockResolvedValue(null);

      await expect(service.remove(9)).rejects.toThrow(
        new NotFoundException('Platform with id 9 not found'),
      );
      expect(mock.game.count).not.toHaveBeenCalled();
    });

    it('refuses with 409 while games reference the platform', async () => {
      mock.platform.findUnique.mockResolvedValue({ id: 1 });
      mock.game.count.mockResolvedValue(2);

      await expect(service.remove(1)).rejects.toThrow(
        new ConflictException(
          'Platform with id 1 has 2 game(s); reassign or delete them before deleting the platform',
        ),
      );
      expect(mock.platform.delete).not.toHaveBeenCalled();
    });

    it('deletes when no games reference the platform', async () => {
      mock.platform.findUnique.mockResolvedValue({ id: 1 });
      mock.game.count.mockResolvedValue(0);
      mock.platform.delete.mockResolvedValue(PS5);

      await service.remove(1);

      expect(mock.platform.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    });

    it('maps a P2003 (FK race) to 409', async () => {
      mock.platform.findUnique.mockResolvedValue({ id: 1 });
      mock.game.count.mockResolvedValue(0);
      mock.platform.delete.mockRejectedValue(knownError('P2003'));

      await expect(service.remove(1)).rejects.toThrow(
        new ConflictException(
          'Platform with id 1 has games; reassign or delete them before deleting the platform',
        ),
      );
    });

    it('maps P2025 (deleted mid-flight) to 404', async () => {
      mock.platform.findUnique.mockResolvedValue({ id: 1 });
      mock.game.count.mockResolvedValue(0);
      mock.platform.delete.mockRejectedValue(knownError('P2025'));

      await expect(service.remove(1)).rejects.toThrow(
        new NotFoundException('Platform with id 1 not found'),
      );
    });
  });
});
