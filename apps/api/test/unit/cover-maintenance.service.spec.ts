import { CoverMaintenanceService } from '../../src/covers/cover-maintenance.service';
import type { CoverCacheService } from '../../src/covers/cover-cache.service';
import { testId } from '../helpers/ids';

function harness() {
  const prisma = {
    game: { count: jest.fn(() => Promise.resolve(0)) },
    gameImage: { count: jest.fn(() => Promise.resolve(0)) },
  };
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
    h.prisma.gameImage.count.mockResolvedValue(0);

    await h.service.removeIfUnreferenced(URL, { exceptCoverGameId: testId(5) });

    // The exclusion applies only to the relation it was scoped for: the cover
    // count skips game 5, the gallery count does not.
    expect(h.prisma.game.count).toHaveBeenCalledWith({
      where: { coverUrl: URL, id: { not: testId(5) } },
    });
    expect(h.prisma.gameImage.count).toHaveBeenCalledWith({
      where: { url: URL },
    });
    expect(h.cache.removeByServedUrl).toHaveBeenCalledWith(URL);
  });

  it('keeps the file while another game still references it as a cover', async () => {
    const h = harness();
    h.prisma.game.count.mockResolvedValue(1);

    await h.service.removeIfUnreferenced(URL);

    expect(h.cache.removeByServedUrl).not.toHaveBeenCalled();
  });

  it('keeps the file while a gallery image still references it', async () => {
    const h = harness();
    h.prisma.game.count.mockResolvedValue(0);
    h.prisma.gameImage.count.mockResolvedValue(1);

    await h.service.removeIfUnreferenced(URL);

    expect(h.prisma.gameImage.count).toHaveBeenCalledWith({
      where: { url: URL },
    });
    expect(h.cache.removeByServedUrl).not.toHaveBeenCalled();
  });

  // Regression: a cover replacement excludes the game from the cover count only.
  // If the game's unchanged gallery still points at the old cover file, the
  // gallery count must still see it and keep the file.
  it('keeps the file when the excluded game still references it as a gallery image', async () => {
    const h = harness();
    h.prisma.game.count.mockResolvedValue(0);
    h.prisma.gameImage.count.mockResolvedValue(1);

    await h.service.removeIfUnreferenced(URL, { exceptCoverGameId: testId(5) });

    expect(h.prisma.gameImage.count).toHaveBeenCalledWith({
      where: { url: URL },
    });
    expect(h.prisma.gameImage.count).not.toHaveBeenCalledWith({
      where: { url: URL, gameId: { not: testId(5) } },
    });
    expect(h.cache.removeByServedUrl).not.toHaveBeenCalled();
  });

  // Regression: a gallery replacement excludes the game from the gallery count
  // only. If the removed gallery file is still the game's current cover, the
  // cover count must still see it and keep the file.
  it('keeps the file when the excluded game still references it as its cover', async () => {
    const h = harness();
    h.prisma.game.count.mockResolvedValue(1);
    h.prisma.gameImage.count.mockResolvedValue(0);

    await h.service.removeIfUnreferenced(URL, { exceptImageGameId: testId(5) });

    expect(h.prisma.game.count).toHaveBeenCalledWith({
      where: { coverUrl: URL },
    });
    expect(h.prisma.gameImage.count).toHaveBeenCalledWith({
      where: { url: URL, gameId: { not: testId(5) } },
    });
    expect(h.cache.removeByServedUrl).not.toHaveBeenCalled();
  });

  it('deletes only when both relation-scoped counts are zero', async () => {
    const h = harness();
    h.prisma.game.count.mockResolvedValue(0);
    h.prisma.gameImage.count.mockResolvedValue(0);

    await h.service.removeIfUnreferenced(URL, {
      exceptCoverGameId: testId(5),
      exceptImageGameId: testId(5),
    });

    expect(h.prisma.game.count).toHaveBeenCalledWith({
      where: { coverUrl: URL, id: { not: testId(5) } },
    });
    expect(h.prisma.gameImage.count).toHaveBeenCalledWith({
      where: { url: URL, gameId: { not: testId(5) } },
    });
    expect(h.cache.removeByServedUrl).toHaveBeenCalledWith(URL);
  });

  it('swallows a database error', async () => {
    const h = harness();
    h.prisma.game.count.mockRejectedValue(new Error('db down'));

    await expect(h.service.removeIfUnreferenced(URL)).resolves.toBeUndefined();
    expect(h.cache.removeByServedUrl).not.toHaveBeenCalled();
  });
});
