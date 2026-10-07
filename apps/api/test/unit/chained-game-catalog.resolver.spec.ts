import {
  ChainedGameCatalogResolver,
  noCatalogSourceMatchedReason,
} from '../../src/game-catalog/chained-game-catalog.resolver';
import type {
  CatalogCandidate,
  CatalogResolution,
  CatalogSearchResult,
  GameCatalogSource,
} from '../../src/game-catalog/game-catalog.resolver';
import type { RecognizedItem } from '../../src/settings/vision/vision-provider';

function item(title: string): RecognizedItem {
  return { title, edition: null, platform: null, confidence: 0.9 };
}

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

type ResolveMock = jest.Mock<Promise<CatalogResolution>, [RecognizedItem]>;

interface FakeSource extends GameCatalogSource {
  label: string;
  resolve: ResolveMock;
  search: SearchMock;
}

function source(label: string, resolve: ResolveMock): FakeSource {
  return {
    label,
    resolve,
    search: jest.fn<Promise<CatalogSearchResult>, [string]>(),
  };
}

/** The call order of a mock's invocation at `index`, asserting it happened. */
function callOrder(mock: ResolveMock, index: number): number {
  const order = mock.mock.invocationCallOrder[index];
  if (order === undefined) {
    throw new Error('expected the source to have been called');
  }
  return order;
}

function mockResolving(resolution: CatalogResolution): ResolveMock {
  return jest
    .fn<Promise<CatalogResolution>, [RecognizedItem]>()
    .mockResolvedValue(resolution);
}

function unrecognized(reason: string): CatalogResolution {
  return { kind: 'unrecognized', reason };
}

describe('noCatalogSourceMatchedReason (unit)', () => {
  it('reports no configured source for an empty miss list', () => {
    expect(noCatalogSourceMatchedReason([])).toBe(
      'No game catalog source is configured',
    );
  });

  it('preserves each source label and reason in order', () => {
    expect(
      noCatalogSourceMatchedReason([
        { label: 'IGDB', reason: 'No IGDB game matched the title' },
        { label: 'MobyGames', reason: 'No MobyGames game matched the title' },
      ]),
    ).toBe(
      'No game matched the title in any source — IGDB: No IGDB game matched the title; MobyGames: No MobyGames game matched the title',
    );
  });
});

describe('ChainedGameCatalogResolver (unit)', () => {
  it('returns the first match and never calls a later source', async () => {
    const igdb = source(
      'IGDB',
      mockResolving({ kind: 'matched', candidate: candidate('Halo') }),
    );
    const fallback = source(
      'MobyGames',
      jest.fn<Promise<CatalogResolution>, [RecognizedItem]>(),
    );
    const resolver = new ChainedGameCatalogResolver([igdb, fallback]);

    const result = await resolver.resolve(item('Halo'));

    expect(result).toEqual({
      kind: 'matched',
      candidate: expect.objectContaining({ title: 'Halo' }) as unknown,
    });
    expect(igdb.resolve).toHaveBeenCalledTimes(1);
    expect(fallback.resolve).not.toHaveBeenCalled();
  });

  it('falls through an unrecognized IGDB to the fallback, in order', async () => {
    const igdb = source(
      'IGDB',
      mockResolving(unrecognized('No IGDB game matched')),
    );
    const fallback = source(
      'MobyGames',
      mockResolving({
        kind: 'matched',
        candidate: candidate('Obscure Gem'),
      }),
    );
    const resolver = new ChainedGameCatalogResolver([igdb, fallback]);

    const result = await resolver.resolve(item('Obscure Gem'));

    expect(result.kind).toBe('matched');
    expect(igdb.resolve).toHaveBeenCalledTimes(1);
    expect(fallback.resolve).toHaveBeenCalledTimes(1);
    expect(callOrder(igdb.resolve, 0)).toBeLessThan(
      callOrder(fallback.resolve, 0),
    );
  });

  it('flags an invented title as unrecognized once every source misses', async () => {
    const igdb = source(
      'IGDB',
      mockResolving(unrecognized('No IGDB game matched')),
    );
    const fallback = source(
      'MobyGames',
      mockResolving(unrecognized('No MobyGames game matched')),
    );
    const resolver = new ChainedGameCatalogResolver([igdb, fallback]);

    const result = await resolver.resolve(item('Zorblax Chronicles 9000'));

    expect(result).toEqual({
      kind: 'unrecognized',
      reason: noCatalogSourceMatchedReason([
        { label: 'IGDB', reason: 'No IGDB game matched' },
        { label: 'MobyGames', reason: 'No MobyGames game matched' },
      ]),
    });
    expect(igdb.resolve).toHaveBeenCalledTimes(1);
    expect(fallback.resolve).toHaveBeenCalledTimes(1);
  });

  it('short-circuits on the first transient and does not fall through', async () => {
    const igdb = source(
      'IGDB',
      mockResolving({ kind: 'transient', reason: 'IGDB 429' }),
    );
    const fallback = source(
      'MobyGames',
      jest.fn<Promise<CatalogResolution>, [RecognizedItem]>(),
    );
    const resolver = new ChainedGameCatalogResolver([igdb, fallback]);

    const result = await resolver.resolve(item('Halo'));

    expect(result).toEqual({ kind: 'transient', reason: 'IGDB 429' });
    expect(fallback.resolve).not.toHaveBeenCalled();
  });

  it('short-circuits on a config_error and does not fall through', async () => {
    const resolution: CatalogResolution = {
      kind: 'config_error',
      source: 'igdb',
      reason: 'IGDB rejected the credentials',
    };
    const igdb = source('IGDB', mockResolving(resolution));
    const fallback = source(
      'MobyGames',
      jest.fn<Promise<CatalogResolution>, [RecognizedItem]>(),
    );
    const resolver = new ChainedGameCatalogResolver([igdb, fallback]);

    const result = await resolver.resolve(item('Halo'));

    expect(result).toEqual(resolution);
    expect(fallback.resolve).not.toHaveBeenCalled();
  });

  it('preserves a later transient rather than dropping the title', async () => {
    const igdb = source(
      'IGDB',
      mockResolving(unrecognized('No IGDB game matched')),
    );
    const fallback = source(
      'MobyGames',
      mockResolving({ kind: 'transient', reason: 'MobyGames 503' }),
    );
    const resolver = new ChainedGameCatalogResolver([igdb, fallback]);

    const result = await resolver.resolve(item('Halo'));

    expect(result).toEqual({ kind: 'transient', reason: 'MobyGames 503' });
    expect(igdb.resolve).toHaveBeenCalledTimes(1);
    expect(fallback.resolve).toHaveBeenCalledTimes(1);
  });

  it('flags unrecognized when no source is configured', async () => {
    const resolver = new ChainedGameCatalogResolver([]);

    const result = await resolver.resolve(item('Halo'));

    expect(result).toEqual({
      kind: 'unrecognized',
      reason: 'No game catalog source is configured',
    });
  });

  it('resolves a batch sequentially through resolve(), once per item in order', async () => {
    const igdb = source(
      'IGDB',
      mockResolving(unrecognized('No IGDB game matched')),
    );
    const fallback = source(
      'MobyGames',
      mockResolving(unrecognized('No MobyGames game matched')),
    );
    const resolver = new ChainedGameCatalogResolver([igdb, fallback]);

    const first = item('First');
    const second = item('Second');
    const results = await resolver.resolveBatch([first, second]);

    // One inherited `resolve()` per item (not a batched IGDB call), returning
    // each item's aggregated miss in input order.
    const miss = {
      kind: 'unrecognized',
      reason: noCatalogSourceMatchedReason([
        { label: 'IGDB', reason: 'No IGDB game matched' },
        { label: 'MobyGames', reason: 'No MobyGames game matched' },
      ]),
    } as const;
    expect(results).toEqual([miss, miss]);

    expect(igdb.resolve).toHaveBeenCalledTimes(2);
    expect(fallback.resolve).toHaveBeenCalledTimes(2);
    expect(igdb.resolve.mock.calls.map(([it]) => it.title)).toEqual([
      'First',
      'Second',
    ]);
    expect(fallback.resolve.mock.calls.map(([it]) => it.title)).toEqual([
      'First',
      'Second',
    ]);

    // For each item the sources are consulted in registration order:
    // first item → IGDB → MobyGames, then second item → IGDB → MobyGames.
    expect(callOrder(igdb.resolve, 0)).toBeLessThan(
      callOrder(fallback.resolve, 0),
    );
    expect(callOrder(fallback.resolve, 0)).toBeLessThan(
      callOrder(igdb.resolve, 1),
    );
    expect(callOrder(igdb.resolve, 1)).toBeLessThan(
      callOrder(fallback.resolve, 1),
    );
  });
});

type SearchMock = jest.Mock<Promise<CatalogSearchResult>, [string]>;

function searchSource(label: string, search: SearchMock): FakeSource {
  return {
    label,
    resolve: jest.fn<Promise<CatalogResolution>, [RecognizedItem]>(),
    search,
  };
}

/** A typed search mock that always resolves the given result. */
function searchReturning(result: CatalogSearchResult): SearchMock {
  return jest.fn<Promise<CatalogSearchResult>, [string]>(() =>
    Promise.resolve(result),
  );
}

/** A typed search mock expected not to be called. */
function unusedSearch(): SearchMock {
  return jest.fn<Promise<CatalogSearchResult>, [string]>();
}

function matches(query: string): CatalogSearchResult {
  return { kind: 'matches', candidates: [candidate(query)] };
}

describe('ChainedGameCatalogResolver.search (unit)', () => {
  it('returns the first source that yields candidates and never consults a later source', async () => {
    const igdb = searchSource('IGDB', searchReturning(matches('Halo')));
    const fallback = searchSource('MobyGames', unusedSearch());
    const resolver = new ChainedGameCatalogResolver([igdb, fallback]);

    const result = await resolver.search('Halo');

    expect(result).toEqual({
      kind: 'matches',
      candidates: [expect.objectContaining({ title: 'Halo' }) as unknown],
    });
    expect(igdb.search).toHaveBeenCalledWith('Halo');
    expect(fallback.search).not.toHaveBeenCalled();
  });

  it('falls through to the next source when an earlier source returns no candidates', async () => {
    const igdb = searchSource(
      'IGDB',
      searchReturning({ kind: 'matches', candidates: [] }),
    );
    const fallback = searchSource(
      'MobyGames',
      searchReturning(matches('Obscure Gem')),
    );
    const resolver = new ChainedGameCatalogResolver([igdb, fallback]);

    const result = await resolver.search('Obscure Gem');

    expect(result.kind).toBe('matches');
    expect(result.kind === 'matches' && result.candidates[0]?.title).toBe(
      'Obscure Gem',
    );
    expect(igdb.search).toHaveBeenCalledTimes(1);
    expect(fallback.search).toHaveBeenCalledTimes(1);
  });

  it('short-circuits on a transient from the first source', async () => {
    const igdb = searchSource(
      'IGDB',
      searchReturning({ kind: 'transient', reason: 'IGDB 429' }),
    );
    const fallback = searchSource('MobyGames', unusedSearch());
    const resolver = new ChainedGameCatalogResolver([igdb, fallback]);

    const result = await resolver.search('Halo');

    expect(result).toEqual({ kind: 'transient', reason: 'IGDB 429' });
    expect(fallback.search).not.toHaveBeenCalled();
  });

  it('returns a config_error from the first source without consulting later sources', async () => {
    const configError: CatalogSearchResult = {
      kind: 'config_error',
      source: 'igdb',
      reason: 'IGDB rejected the credentials',
    };
    const igdb = searchSource('IGDB', searchReturning(configError));
    const fallback = searchSource('MobyGames', unusedSearch());
    const resolver = new ChainedGameCatalogResolver([igdb, fallback]);

    await expect(resolver.search('Halo')).resolves.toEqual(configError);
    expect(fallback.search).not.toHaveBeenCalled();
  });

  it('returns an empty candidate list when no source is configured', async () => {
    const resolver = new ChainedGameCatalogResolver([]);

    await expect(resolver.search('Halo')).resolves.toEqual({
      kind: 'matches',
      candidates: [],
    });
  });
});
