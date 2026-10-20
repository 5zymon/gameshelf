import type { PrismaService } from '../../src/prisma/prisma.service';
import { StatsService } from '../../src/stats/stats.service';

function createService(aggregate: unknown): {
  service: StatsService;
  mock: { game: { aggregate: jest.Mock } };
} {
  const mock = { game: { aggregate: jest.fn().mockResolvedValue(aggregate) } };
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

    await expect(service.getStats()).resolves.toEqual({
      totals: { games: 3, copies: 5 },
    });
    expect(mock.game.aggregate).toHaveBeenCalledWith({
      _count: { _all: true },
      _sum: { copyCount: true },
    });
  });

  it('returns zeros for an empty collection (null sum)', async () => {
    const { service } = createService({
      _count: { _all: 0 },
      _sum: { copyCount: null },
    });

    await expect(service.getStats()).resolves.toEqual({
      totals: { games: 0, copies: 0 },
    });
  });
});
