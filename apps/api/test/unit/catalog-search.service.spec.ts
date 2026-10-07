import { CatalogSearchService } from '../../src/game-catalog/catalog-search.service';
import type {
  CatalogCandidate,
  CatalogSearchResult,
  GameCatalogResolver,
} from '../../src/game-catalog/game-catalog.resolver';
import {
  CATALOG_SEARCH_CACHE_TTL_MS,
  CATALOG_SEARCH_MIN_QUERY_LENGTH,
} from '../../src/game-catalog/catalog-search.options';

function candidate(title: string): CatalogCandidate {
  return {
    externalId: 1,
    title,
    releaseYear: 2001,
    publisher: null,
    genre: null,
    playerCount: null,
    coverUrl: null,
    platforms: [],
    source: 'IGDB',
    raw: {},
  };
}

function matches(title: string): CatalogSearchResult {
  return { kind: 'matches', candidates: [candidate(title)] };
}

function createService(search: jest.Mock): {
  service: CatalogSearchService;
  search: jest.Mock;
} {
  const service = new CatalogSearchService({
    search,
  } as unknown as GameCatalogResolver);
  return { service, search };
}

describe('CatalogSearchService (unit)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns [] without calling the resolver below the minimum length', async () => {
    const search = jest.fn();
    const { service } = createService(search);

    await expect(
      service.search('h'.repeat(CATALOG_SEARCH_MIN_QUERY_LENGTH - 1)),
    ).resolves.toEqual({ kind: 'matches', candidates: [] });
    expect(search).not.toHaveBeenCalled();
  });

  it('caches a successful result for the TTL window', async () => {
    const search = jest.fn(() => Promise.resolve(matches('Halo')));
    const { service } = createService(search);

    const first = await service.search('halo');
    const second = await service.search('  Halo  ');

    expect(search).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(second).toEqual({
      kind: 'matches',
      candidates: [expect.objectContaining({ title: 'Halo' })],
    });
  });

  it('re-calls the resolver after the TTL expires', async () => {
    const search = jest.fn(() => Promise.resolve(matches('Halo')));
    const { service } = createService(search);

    await service.search('halo');
    jest.advanceTimersByTime(CATALOG_SEARCH_CACHE_TTL_MS + 1);
    await service.search('halo');

    expect(search).toHaveBeenCalledTimes(2);
  });

  it('coalesces two concurrent identical lookups into one call', async () => {
    let resolve: (value: CatalogSearchResult) => void = () => undefined;
    const search = jest.fn(
      () =>
        new Promise<CatalogSearchResult>((r) => {
          resolve = r;
        }),
    );
    const { service } = createService(search);

    const first = service.search('halo');
    const second = service.search('halo');
    resolve(matches('Halo'));

    await expect(first).resolves.toEqual(await second);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('makes a separate call for a different query', async () => {
    const search = jest.fn((query: string) => Promise.resolve(matches(query)));
    const { service } = createService(search);

    await service.search('halo');
    await service.search('doom');

    expect(search).toHaveBeenCalledTimes(2);
    expect(search.mock.calls.map(([q]) => q)).toEqual(['halo', 'doom']);
  });

  it('returns transient and config_error results as-is and never caches them', async () => {
    const transient: CatalogSearchResult = {
      kind: 'transient',
      reason: 'IGDB 429',
    };
    const configError: CatalogSearchResult = {
      kind: 'config_error',
      source: 'igdb',
      reason: 'IGDB rejected the credentials',
    };
    const search = jest
      .fn()
      .mockResolvedValueOnce(transient)
      .mockResolvedValueOnce(configError);
    const { service } = createService(search);

    await expect(service.search('halo')).resolves.toEqual(transient);
    await expect(service.search('halo')).resolves.toEqual(configError);
    expect(search).toHaveBeenCalledTimes(2);
  });
});
