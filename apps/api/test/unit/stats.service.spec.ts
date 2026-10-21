import type { PrismaService } from '../../src/prisma/prisma.service';
import { StatsService } from '../../src/stats/stats.service';

function createService(
  aggregate: unknown,
  platforms: unknown[] = [],
  unverified = 0,
  years: unknown[] = [],
): {
  service: StatsService;
  mock: {
    game: { aggregate: jest.Mock; count: jest.Mock; groupBy: jest.Mock };
    platform: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };
} {
  const mock = {
    game: {
      aggregate: jest.fn().mockResolvedValue(aggregate),
      count: jest.fn().mockResolvedValue(unverified),
      groupBy: jest.fn().mockResolvedValue(years),
    },
    platform: { findMany: jest.fn().mockResolvedValue(platforms) },
    $transaction: jest.fn((calls: Promise<unknown>[]) => Promise.all(calls)),
  };
  return {
    service: new StatsService(mock as unknown as PrismaService),
    mock,
  };
}

describe('StatsService', () => {
  it('returns the number of games and the sum of copies', async () => {
    const { service, mock } = createService({
      _count: { _all: 3 },
      _sum: { copyCount: 5 },
    });

    await expect(service.getStats()).resolves.toMatchObject({
      totals: { games: 3, copies: 5 },
    });
    expect(mock.game.aggregate).toHaveBeenCalledWith({
      _count: { _all: true },
      _sum: { copyCount: true },
    });
  });

  it('returns zeros and no platforms for an empty collection', async () => {
    const { service } = createService({
      _count: { _all: 0 },
      _sum: { copyCount: null },
    });

    await expect(service.getStats()).resolves.toEqual({
      totals: { games: 0, copies: 0 },
      platforms: [],
      dataQuality: { unverifiedPlatform: 0 },
      decades: [],
      noReleaseYear: 0,
    });
  });

  it('sorts platforms by games descending, then name ascending', async () => {
    const { service, mock } = createService(
      { _count: { _all: 6 }, _sum: { copyCount: 6 } },
      [
        { id: 'b', name: 'PC', _count: { games: 1 } },
        { id: 'a', name: 'Xbox', _count: { games: 3 } },
        { id: 'c', name: 'Amiga', _count: { games: 1 } },
        { id: 'd', name: 'Switch', _count: { games: 1 } },
      ],
      2,
    );

    await expect(service.getStats()).resolves.toMatchObject({
      platforms: [
        { id: 'a', name: 'Xbox', games: 3 },
        { id: 'c', name: 'Amiga', games: 1 },
        { id: 'b', name: 'PC', games: 1 },
        { id: 'd', name: 'Switch', games: 1 },
      ],
      dataQuality: { unverifiedPlatform: 2 },
    });
    expect(mock.platform.findMany).toHaveBeenCalledWith({
      where: { games: { some: {} } },
      select: { id: true, name: true, _count: { select: { games: true } } },
    });
    expect(mock.game.count).toHaveBeenCalledWith({
      where: { platformUnverified: true },
    });
  });

  it('folds release years into decades, ascending, and counts no-year games', async () => {
    const { service, mock } = createService(
      { _count: { _all: 6 }, _sum: { copyCount: 6 } },
      [],
      0,
      [
        { releaseYear: 2001, _count: { _all: 1 } },
        { releaseYear: null, _count: { _all: 1 } },
        { releaseYear: 1999, _count: { _all: 1 } },
        { releaseYear: 1994, _count: { _all: 1 } },
      ],
    );

    await expect(service.getStats()).resolves.toMatchObject({
      decades: [
        { decade: 1990, games: 2 },
        { decade: 2000, games: 1 },
      ],
      noReleaseYear: 1,
    });
    expect(mock.game.groupBy).toHaveBeenCalledWith({
      by: ['releaseYear'],
      orderBy: { releaseYear: 'asc' },
      _count: { _all: true },
    });
  });
});
