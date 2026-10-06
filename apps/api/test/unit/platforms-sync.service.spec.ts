import type {
  IgdbClient,
  IgdbPlatform,
} from '../../src/game-catalog/igdb.client';
import type { PlatformMatchCandidate } from '../../src/platforms/platform-match';
import { PlatformsSyncService } from '../../src/platforms/platforms-sync.service';
import type { PlatformsService } from '../../src/platforms/platforms.service';

interface IgdbMock {
  fetchPlatforms: jest.Mock;
}

interface PlatformsMock {
  listMatchCandidates: jest.Mock;
  createCanonical: jest.Mock;
  updateCanonical: jest.Mock;
}

function createSync(): {
  sync: PlatformsSyncService;
  igdb: IgdbMock;
  platforms: PlatformsMock;
} {
  const igdb: IgdbMock = { fetchPlatforms: jest.fn() };
  const platforms: PlatformsMock = {
    listMatchCandidates: jest.fn(),
    createCanonical: jest.fn(),
    updateCanonical: jest.fn(),
  };
  return {
    sync: new PlatformsSyncService(
      igdb as unknown as IgdbClient,
      platforms as unknown as PlatformsService,
    ),
    igdb,
    platforms,
  };
}

function existing(
  overrides: Partial<PlatformMatchCandidate> & { id: number },
): PlatformMatchCandidate {
  return {
    name: '',
    abbreviation: null,
    alternativeName: null,
    ...overrides,
  };
}

describe('PlatformsSyncService (unit)', () => {
  it('fetches the platform list once and reads candidates once', async () => {
    const { sync, igdb, platforms } = createSync();
    igdb.fetchPlatforms.mockResolvedValue([{ id: 1, name: 'PC' }]);
    platforms.listMatchCandidates.mockResolvedValue([]);
    platforms.createCanonical.mockResolvedValue(
      existing({ id: 100, name: 'PC' }),
    );

    await sync.sync();

    expect(igdb.fetchPlatforms).toHaveBeenCalledTimes(1);
    expect(platforms.listMatchCandidates).toHaveBeenCalledTimes(1);
    expect(platforms.createCanonical).toHaveBeenCalledTimes(1);
  });

  it('reuses an existing platform by abbreviation instead of creating', async () => {
    const { sync, igdb, platforms } = createSync();
    igdb.fetchPlatforms.mockResolvedValue([
      {
        id: 130,
        name: 'PlayStation 5',
        abbreviation: 'PS5',
        platform_family: 1,
      },
    ]);
    const custom = existing({ id: 9, name: 'PS5' });
    platforms.listMatchCandidates.mockResolvedValue([custom]);
    platforms.updateCanonical.mockResolvedValue(true);

    const result = await sync.sync();

    expect(platforms.createCanonical).not.toHaveBeenCalled();
    expect(platforms.updateCanonical).toHaveBeenCalledWith(9, {
      name: 'PlayStation 5',
      abbreviation: 'PS5',
      alternativeName: null,
      platformFamily: 1,
      igdbId: 130,
    });
    expect(result).toEqual({
      fetched: 1,
      created: 0,
      updated: 1,
      unchanged: 0,
    });
  });

  it('creates an unknown platform with its family and IGDB id', async () => {
    const { sync, igdb, platforms } = createSync();
    igdb.fetchPlatforms.mockResolvedValue([
      { id: 7, name: 'Xbox', abbreviation: 'XBOX', platform_family: 2 },
    ]);
    platforms.listMatchCandidates.mockResolvedValue([]);
    const created = existing({ id: 100, name: 'Xbox', abbreviation: 'XBOX' });
    platforms.createCanonical.mockResolvedValue(created);

    const result = await sync.sync();

    expect(platforms.createCanonical).toHaveBeenCalledWith({
      name: 'Xbox',
      abbreviation: 'XBOX',
      alternativeName: null,
      platformFamily: 2,
      igdbId: 7,
    });
    expect(result).toEqual({
      fetched: 1,
      created: 1,
      updated: 0,
      unchanged: 0,
    });
  });

  it('creates rather than updates on a near-miss', async () => {
    const { sync, igdb, platforms } = createSync();
    igdb.fetchPlatforms.mockResolvedValue([
      { id: 2, name: 'PlayStation 4', abbreviation: 'PS4' },
    ]);
    platforms.listMatchCandidates.mockResolvedValue([
      existing({ id: 1, name: 'PlayStation 5', abbreviation: 'PS5' }),
    ]);
    platforms.createCanonical.mockResolvedValue(
      existing({ id: 100, name: 'PlayStation 4', abbreviation: 'PS4' }),
    );

    const result = await sync.sync();

    expect(platforms.updateCanonical).not.toHaveBeenCalled();
    expect(platforms.createCanonical).toHaveBeenCalledTimes(1);
    expect(result.created).toBe(1);
  });

  it('counts an unchanged match when no field differs', async () => {
    const { sync, igdb, platforms } = createSync();
    igdb.fetchPlatforms.mockResolvedValue([{ id: 6, name: 'PC' }]);
    platforms.listMatchCandidates.mockResolvedValue([
      existing({ id: 3, name: 'PC' }),
    ]);
    platforms.updateCanonical.mockResolvedValue(false);

    const result = await sync.sync();

    expect(result).toEqual({
      fetched: 1,
      created: 0,
      updated: 0,
      unchanged: 1,
    });
  });

  it('aggregates created, updated, and unchanged counts', async () => {
    const { sync, igdb, platforms } = createSync();
    igdb.fetchPlatforms.mockResolvedValue([
      { id: 1, name: 'PC' },
      { id: 2, name: 'PlayStation 5', abbreviation: 'PS5' },
      { id: 3, name: 'Xbox', abbreviation: 'XBOX' },
    ]);
    platforms.listMatchCandidates.mockResolvedValue([
      existing({ id: 10, name: 'PC' }),
      existing({ id: 11, name: 'PS5' }),
    ]);
    platforms.updateCanonical
      .mockResolvedValueOnce(true) // PC changed
      .mockResolvedValueOnce(false); // PS5 unchanged
    platforms.createCanonical.mockResolvedValue(
      existing({ id: 100, name: 'Xbox', abbreviation: 'XBOX' }),
    );

    const result = await sync.sync();

    expect(result).toEqual({
      fetched: 3,
      created: 1,
      updated: 1,
      unchanged: 1,
    });
  });

  it('skips rows whose name normalizes to nothing', async () => {
    const { sync, igdb, platforms } = createSync();
    igdb.fetchPlatforms.mockResolvedValue([{ id: 1, name: '   ' }]);
    platforms.listMatchCandidates.mockResolvedValue([]);

    const result = await sync.sync();

    expect(platforms.createCanonical).not.toHaveBeenCalled();
    expect(result).toEqual({
      fetched: 1,
      created: 0,
      updated: 0,
      unchanged: 0,
    });
  });

  it('does not create twice for duplicate IGDB rows', async () => {
    const { sync, igdb, platforms } = createSync();
    igdb.fetchPlatforms.mockResolvedValue([
      { id: 1, name: 'PC' },
      { id: 2, name: 'PC' },
    ]);
    platforms.listMatchCandidates.mockResolvedValue([]);
    platforms.createCanonical.mockResolvedValue(
      existing({ id: 100, name: 'PC' }),
    );
    platforms.updateCanonical.mockResolvedValue(false);

    const result = await sync.sync();

    expect(platforms.createCanonical).toHaveBeenCalledTimes(1);
    expect(platforms.updateCanonical).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      fetched: 2,
      created: 1,
      updated: 0,
      unchanged: 1,
    });
  });

  it('trims fields and normalizes a missing platform_family to null', async () => {
    const { sync, igdb, platforms } = createSync();
    const fetched: IgdbPlatform[] = [
      {
        id: 5,
        name: '  PC  ',
        abbreviation: '  ',
        alternative_name: ' Personal Computer ',
      },
    ];
    igdb.fetchPlatforms.mockResolvedValue(fetched);
    platforms.listMatchCandidates.mockResolvedValue([]);
    platforms.createCanonical.mockResolvedValue(
      existing({ id: 100, name: 'PC' }),
    );

    await sync.sync();

    expect(platforms.createCanonical).toHaveBeenCalledWith({
      name: 'PC',
      abbreviation: null,
      alternativeName: 'Personal Computer',
      platformFamily: null,
      igdbId: 5,
    });
  });
});
