import { CoverMaintenanceService } from '../../src/covers/cover-maintenance.service';
import type { CoverCacheService } from '../../src/covers/cover-cache.service';

function harness() {
  const prisma = { game: { count: jest.fn(() => Promise.resolve(0)) } };
  const cache = { removeByServedUrl: jest.fn(() => Promise.resolve()) };
  return {
    service: new CoverMaintenanceService(
      prisma as never,
      cache as unknown as CoverCacheService,
    ),
    prisma,
    cache,
  };
}

const URL = `/api/covers/${'a'.repeat(32)}.jpg`;

describe('CoverMaintenanceService (unit)', () => {
  it('is a no-op for a null cover without querying', async () => {
    const h = harness();
    await h.service.removeIfUnreferenced(null);
    expect(h.prisma.game.count).not.toHaveBeenCalled();
    expect(h.cache.removeByServedUrl).not.toHaveBeenCalled();
  });

  it('deletes the file when no other game references it', async () => {
    const h = harness();
    h.prisma.game.count.mockResolvedValue(0);

    await h.service.removeIfUnreferenced(URL, 5);

    expect(h.prisma.game.count).toHaveBeenCalledWith({
      where: { coverUrl: URL, id: { not: 5 } },
    });
    expect(h.cache.removeByServedUrl).toHaveBeenCalledWith(URL);
  });

  it('keeps the file while another game still references it', async () => {
    const h = harness();
    h.prisma.game.count.mockResolvedValue(1);

    await h.service.removeIfUnreferenced(URL);

    expect(h.cache.removeByServedUrl).not.toHaveBeenCalled();
  });

  it('swallows a database error', async () => {
    const h = harness();
    h.prisma.game.count.mockRejectedValue(new Error('db down'));

    await expect(h.service.removeIfUnreferenced(URL)).resolves.toBeUndefined();
    expect(h.cache.removeByServedUrl).not.toHaveBeenCalled();
  });
});
