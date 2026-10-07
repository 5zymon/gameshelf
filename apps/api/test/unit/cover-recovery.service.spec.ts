import { CoverRecoveryService } from '../../src/covers/cover-recovery.service';
import {
  COVER_PREVIEW_HOSTS_ENV,
  COVER_RETRY_SWEEP_MAX_PAGES,
} from '../../src/covers/covers.options';

const LOCAL = `/api/covers/${'a'.repeat(32)}.jpg`;

// Allowlisted for the default (no `COVER_PREVIEW_HOSTS`) config.
const SOURCE_A = 'https://images.igdb.com/igdb/image/upload/a.jpg';
const SOURCE_B = 'https://images.igdb.com/igdb/image/upload/b.jpg';
const SOURCE_C = 'https://images.igdb.com/igdb/image/upload/c.jpg';

function harness(previewHosts?: string) {
  const prisma = {
    game: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(() => Promise.resolve({})),
    },
  };
  const cache = {
    fileFromServedUrl: jest.fn((url: string | null) => {
      const prefix = '/api/covers/';
      const safe = url ?? '';
      return safe.startsWith(prefix) ? safe.slice(prefix.length) : null;
    }),
    has: jest.fn((_file: string) => Promise.resolve(false)),
    cacheFromUrl: jest.fn(),
    ensureThumbnail: jest.fn((_file: string) => Promise.resolve(true)),
  };
  const config = {
    get: (key: string) =>
      key === COVER_PREVIEW_HOSTS_ENV ? previewHosts : undefined,
  };
  return {
    service: new CoverRecoveryService(
      prisma as never,
      cache as never,
      config as never,
    ),
    prisma,
    cache,
  };
}

describe('CoverRecoveryService (unit)', () => {
  describe('redownloadMissing', () => {
    it('counts present, downloaded, failed and no-source games', async () => {
      const h = harness();
      h.prisma.game.count.mockResolvedValue(2);
      h.prisma.game.findMany
        .mockResolvedValueOnce([
          { id: 1, coverUrl: LOCAL, sourceCoverUrl: SOURCE_A },
          { id: 2, coverUrl: null, sourceCoverUrl: SOURCE_B },
          { id: 3, coverUrl: null, sourceCoverUrl: SOURCE_C },
        ])
        .mockResolvedValueOnce([]);
      // Game 1's file is present; game 3's re-download fails.
      h.cache.has.mockImplementation((file: string) =>
        Promise.resolve(file === `${'a'.repeat(32)}.jpg`),
      );
      h.cache.cacheFromUrl.mockImplementation((url: string) =>
        Promise.resolve(url === SOURCE_B ? '/api/covers/new.jpg' : null),
      );

      const result = await h.service.redownloadMissing();

      expect(result).toEqual({
        total: 3,
        alreadyPresent: 1,
        downloaded: 1,
        failed: 1,
        noSource: 2,
      });
      expect(h.cache.ensureThumbnail).toHaveBeenCalledWith(
        `${'a'.repeat(32)}.jpg`,
      );
      expect(h.cache.ensureThumbnail).toHaveBeenCalledWith('new.jpg');
      expect(h.prisma.game.update).toHaveBeenCalledWith({
        where: { id: 2 },
        data: { coverUrl: '/api/covers/new.jpg' },
      });
    });

    it('rejects when the database read fails, instead of reporting a hollow success', async () => {
      const h = harness();
      h.prisma.game.count.mockResolvedValue(0);
      h.prisma.game.findMany.mockRejectedValue(new Error('db down'));

      await expect(h.service.redownloadMissing()).rejects.toThrow('db down');
    });

    it('rejects when the initial count fails', async () => {
      const h = harness();
      h.prisma.game.count.mockRejectedValue(new Error('count down'));

      await expect(h.service.redownloadMissing()).rejects.toThrow('count down');
    });

    it('counts a per-game update failure as failed and continues to later games', async () => {
      const h = harness();
      h.prisma.game.count.mockResolvedValue(0);
      h.prisma.game.findMany
        .mockResolvedValueOnce([
          { id: 1, coverUrl: null, sourceCoverUrl: SOURCE_A },
          { id: 2, coverUrl: null, sourceCoverUrl: SOURCE_B },
        ])
        .mockResolvedValueOnce([]);
      h.cache.cacheFromUrl.mockResolvedValue('/api/covers/ok.jpg');
      // The first row's write throws; the run must not abort and must count it.
      h.prisma.game.update
        .mockRejectedValueOnce(new Error('update failed'))
        .mockResolvedValueOnce({});

      const result = await h.service.redownloadMissing();

      expect(result).toEqual({
        total: 2,
        alreadyPresent: 0,
        downloaded: 1,
        failed: 1,
        noSource: 0,
      });
      expect(h.prisma.game.update).toHaveBeenCalledTimes(2);
    });

    it('classifies an off-allowlist source link as unrecoverable, not failed', async () => {
      const h = harness();
      h.prisma.game.count.mockResolvedValue(0);
      h.prisma.game.findMany
        .mockResolvedValueOnce([
          {
            id: 1,
            coverUrl: null,
            sourceCoverUrl: 'https://evil.example/x.jpg',
          },
        ])
        .mockResolvedValueOnce([]);

      const result = await h.service.redownloadMissing();

      expect(result).toEqual({
        total: 1,
        alreadyPresent: 0,
        downloaded: 0,
        failed: 0,
        noSource: 1,
      });
      // No download is attempted for a host the cache would reject anyway.
      expect(h.cache.cacheFromUrl).not.toHaveBeenCalled();
    });

    it('downloads a source host allowed by the COVER_PREVIEW_HOSTS override', async () => {
      const h = harness('cdn.example.com');
      h.prisma.game.count.mockResolvedValue(0);
      h.prisma.game.findMany
        .mockResolvedValueOnce([
          {
            id: 1,
            coverUrl: null,
            sourceCoverUrl: 'https://cdn.example.com/a.jpg',
          },
        ])
        .mockResolvedValueOnce([]);
      h.cache.cacheFromUrl.mockResolvedValue('/api/covers/new.jpg');

      const result = await h.service.redownloadMissing();

      expect(result).toMatchObject({ total: 1, downloaded: 1, failed: 0 });
      expect(h.cache.cacheFromUrl).toHaveBeenCalledWith(
        'https://cdn.example.com/a.jpg',
      );
    });
  });

  describe('refreshGame', () => {
    it('returns false on a failed download, then true once it succeeds', async () => {
      const h = harness();
      h.prisma.game.findUnique.mockResolvedValue({
        id: 1,
        coverUrl: null,
        sourceCoverUrl: SOURCE_A,
      });
      h.cache.cacheFromUrl.mockResolvedValueOnce(null);
      await expect(h.service.refreshGame(1)).resolves.toBe(false);
      expect(h.prisma.game.update).not.toHaveBeenCalled();

      h.prisma.game.findUnique.mockResolvedValue({
        id: 1,
        coverUrl: null,
        sourceCoverUrl: SOURCE_A,
      });
      h.cache.cacheFromUrl.mockResolvedValueOnce(LOCAL);
      await expect(h.service.refreshGame(1)).resolves.toBe(true);
      expect(h.prisma.game.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { coverUrl: LOCAL },
      });
      expect(h.cache.ensureThumbnail).toHaveBeenCalledWith(
        `${'a'.repeat(32)}.jpg`,
      );
    });

    it('is a no-op for a missing game or one without a source link', async () => {
      const h = harness();
      h.prisma.game.findUnique.mockResolvedValueOnce(null);
      await expect(h.service.refreshGame(1)).resolves.toBe(true);

      h.prisma.game.findUnique.mockResolvedValueOnce({
        id: 2,
        coverUrl: null,
        sourceCoverUrl: null,
      });
      await expect(h.service.refreshGame(2)).resolves.toBe(true);
      expect(h.cache.cacheFromUrl).not.toHaveBeenCalled();
    });

    it('treats an off-allowlist source as resolved without attempting the download', async () => {
      const h = harness();
      h.prisma.game.findUnique.mockResolvedValue({
        id: 1,
        coverUrl: null,
        sourceCoverUrl: 'https://evil.example/x.jpg',
      });

      await expect(h.service.refreshGame(1)).resolves.toBe(true);
      expect(h.cache.cacheFromUrl).not.toHaveBeenCalled();
      expect(h.prisma.game.update).not.toHaveBeenCalled();
    });
  });

  describe('retryMissing', () => {
    it('retries the placeholder games and counts successes', async () => {
      const h = harness();
      h.prisma.game.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
      const spy = jest
        .spyOn(h.service, 'refreshGame')
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      await expect(h.service.retryMissing()).resolves.toBe(1);

      expect(h.prisma.game.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { coverUrl: null, sourceCoverUrl: { not: null } },
        }),
      );
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('pages past a full first batch so low-id failures do not starve higher ids', async () => {
      const h = harness();
      h.prisma.game.findMany
        .mockResolvedValueOnce([{ id: 1 }, { id: 2 }])
        .mockResolvedValueOnce([{ id: 3 }, { id: 4 }])
        .mockResolvedValueOnce([]);
      const spy = jest
        .spyOn(h.service, 'refreshGame')
        .mockImplementation((id: number) => Promise.resolve(id >= 3));

      await expect(h.service.retryMissing(2)).resolves.toBe(2);

      // The second page resumes after the last id of the first, so the
      // permanently-failing low ids are not selected again this sweep.
      expect(h.prisma.game.findMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: {
            coverUrl: null,
            sourceCoverUrl: { not: null },
            id: { gt: 2 },
          },
          take: 2,
        }),
      );
      expect(spy).toHaveBeenCalledTimes(4);
    });

    it('rotates the cursor after a capped sweep so later sweeps continue past it', async () => {
      const h = harness();
      const spy = jest.spyOn(h.service, 'refreshGame').mockResolvedValue(false);
      // COVER_RETRY_SWEEP_MAX_PAGES full one-row pages hit the sweep cap.
      for (let id = 1; id <= COVER_RETRY_SWEEP_MAX_PAGES; id += 1) {
        h.prisma.game.findMany.mockResolvedValueOnce([{ id }]);
      }

      await h.service.retryMissing(1);

      expect(h.prisma.game.findMany).toHaveBeenCalledTimes(
        COVER_RETRY_SWEEP_MAX_PAGES,
      );

      h.prisma.game.findMany.mockResolvedValueOnce([]);
      await h.service.retryMissing(1);

      expect(h.prisma.game.findMany).toHaveBeenNthCalledWith(
        COVER_RETRY_SWEEP_MAX_PAGES + 1,
        expect.objectContaining({
          where: {
            coverUrl: null,
            sourceCoverUrl: { not: null },
            id: { gt: COVER_RETRY_SWEEP_MAX_PAGES },
          },
        }),
      );
      expect(spy).toHaveBeenCalledTimes(COVER_RETRY_SWEEP_MAX_PAGES);
    });
  });
});
