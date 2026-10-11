import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  IgdbGameCatalogResolver,
  normalizeTitle,
} from '../../src/game-catalog/igdb-game-catalog.resolver';
import { IgdbConfigError, IgdbError } from '../../src/game-catalog/igdb.errors';
import { IgdbClient, type IgdbGame } from '../../src/game-catalog/igdb.client';
import type { RecognizedItem } from '../../src/settings/vision/vision-provider';

function item(title: string): RecognizedItem {
  return { title, edition: null, platform: null, confidence: 0.9 };
}

function game(overrides: Partial<IgdbGame>): IgdbGame {
  return { id: 1, name: 'Halo', ...overrides };
}

/** Loads a real (sanitised) IGDB payload from `test/fixtures/igdb`. */
function igdbFixture(name: string): IgdbGame {
  return JSON.parse(
    readFileSync(join(__dirname, '..', 'fixtures', 'igdb', name), 'utf8'),
  ) as IgdbGame;
}

function createResolver(
  searchGames: jest.Mock<Promise<IgdbGame[]>, [string]>,
): IgdbGameCatalogResolver {
  return new IgdbGameCatalogResolver({
    searchGames,
  } as unknown as IgdbClient);
}

type BatchMock = jest.Mock<Promise<IgdbGame[][]>, [readonly string[]]>;

function createBatchResolver(
  multiqueryGames: BatchMock,
): IgdbGameCatalogResolver {
  return new IgdbGameCatalogResolver({
    searchGames: jest.fn(),
    multiqueryGames,
  } as unknown as IgdbClient);
}

describe('normalizeTitle (unit)', () => {
  it('lowercases, strips diacritics and punctuation, and collapses spaces', () => {
    expect(normalizeTitle('  Pokémon:  Édition   Rouge! ')).toBe(
      'pokemon edition rouge',
    );
  });
});

describe('IgdbGameCatalogResolver (unit)', () => {
  it('matches a candidate whose normalized name equals the title', async () => {
    const search = jest
      .fn<Promise<IgdbGame[]>, [string]>()
      .mockResolvedValue([game({ id: 7, name: 'Halo' })]);
    const resolver = createResolver(search);

    const result = await resolver.resolve(item('halo'));

    expect(result).toEqual({
      kind: 'matched',
      candidate: expect.objectContaining({
        externalId: 7,
        title: 'Halo',
      }) as unknown,
    });
  });

  it('accepts a containment match at the 0.8 length ratio', async () => {
    // "halo" (4) contained in "halo combat evolved" (19) -> ratio 0.21, no.
    // "halo combat evolved" vs "halo combat" -> 11/19 = 0.58, no.
    // Use names where the ratio clears 0.8.
    const search = jest
      .fn<Promise<IgdbGame[]>, [string]>()
      .mockResolvedValue([game({ id: 2, name: 'Halo Combat Evolved' })]);
    const resolver = createResolver(search);

    const result = await resolver.resolve(item('Halo Combat Evolve'));

    expect(result.kind).toBe('matched');
  });

  it('rejects a containment match below the length ratio', async () => {
    const search = jest
      .fn<Promise<IgdbGame[]>, [string]>()
      .mockResolvedValue([game({ id: 2, name: 'Halo Combat Evolved' })]);
    const resolver = createResolver(search);

    const result = await resolver.resolve(item('Halo'));

    expect(result).toEqual({
      kind: 'unrecognized',
      reason: 'No IGDB game matched the title',
    });
  });

  it('accepts a candidate that differs by a minor typo', async () => {
    const search = jest
      .fn<Promise<IgdbGame[]>, [string]>()
      .mockResolvedValue([game({ id: 7, name: 'Halo' })]);
    const resolver = createResolver(search);

    const result = await resolver.resolve(item('Haloo'));

    expect(result.kind).toBe('matched');
  });

  it('does not match a sequel as a typo', async () => {
    const search = jest
      .fn<Promise<IgdbGame[]>, [string]>()
      .mockResolvedValue([game({ id: 9, name: 'Fifa 23' })]);
    const resolver = createResolver(search);

    const result = await resolver.resolve(item('Fifa 24'));

    expect(result).toEqual({
      kind: 'unrecognized',
      reason: 'No IGDB game matched the title',
    });
  });

  it('returns unrecognized when IGDB has no candidates', async () => {
    const search = jest
      .fn<Promise<IgdbGame[]>, [string]>()
      .mockResolvedValue([]);
    const resolver = createResolver(search);

    await expect(resolver.resolve(item('Unknown'))).resolves.toEqual({
      kind: 'unrecognized',
      reason: 'No IGDB game matched the title',
    });
  });

  it('maps a transient IgdbError to a transient resolution', async () => {
    const search = jest
      .fn<Promise<IgdbGame[]>, [string]>()
      .mockRejectedValue(new IgdbError(true, 'IGDB rate-limited the request'));
    const resolver = createResolver(search);

    await expect(resolver.resolve(item('Halo'))).resolves.toEqual({
      kind: 'transient',
      reason: 'IGDB rate-limited the request',
    });
  });

  it('maps an IgdbConfigError to a config_error resolution', async () => {
    const search = jest
      .fn<Promise<IgdbGame[]>, [string]>()
      .mockRejectedValue(new IgdbConfigError('IGDB rejected the credentials'));
    const resolver = createResolver(search);

    await expect(resolver.resolve(item('Halo'))).resolves.toEqual({
      kind: 'config_error',
      source: 'igdb',
      reason: 'IGDB rejected the credentials',
    });
  });

  it('maps a generic permanent IgdbError to an unrecognized resolution', async () => {
    const search = jest
      .fn<Promise<IgdbGame[]>, [string]>()
      .mockRejectedValue(new IgdbError(false, 'IGDB malformed query'));
    const resolver = createResolver(search);

    await expect(resolver.resolve(item('Halo'))).resolves.toEqual({
      kind: 'unrecognized',
      reason: 'IGDB malformed query',
    });
  });

  it('carries the IGDB slug onto the candidate', async () => {
    const search = jest
      .fn<Promise<IgdbGame[]>, [string]>()
      .mockResolvedValue([game({ name: 'Halo', slug: 'halo-combat-evolved' })]);
    const resolver = createResolver(search);

    const result = await resolver.search('Halo');

    expect(result).toMatchObject({
      kind: 'matches',
      candidates: [{ slug: 'halo-combat-evolved' }],
    });
  });

  it('normalizes cover URLs and maps the first company/genre/platform', async () => {
    const search = jest.fn<Promise<IgdbGame[]>, [string]>().mockResolvedValue([
      game({
        name: 'Halo',
        first_release_date: 978307200, // 2001-01-01T00:00:00Z
        cover: { url: '//images.igdb.com/igdb/image/upload/t_thumb/halo.jpg' },
        involved_companies: [{ company: { name: 'Bungie' } }],
        genres: [{ name: 'Shooter' }],
        platforms: [{ id: 11, name: 'Xbox', abbreviation: 'XBOX' }],
      }),
    ]);
    const resolver = createResolver(search);

    const result = await resolver.resolve(item('Halo'));

    expect(result).toEqual({
      kind: 'matched',
      candidate: {
        externalId: 1,
        title: 'Halo',
        releaseYear: 2001,
        publisher: 'Bungie',
        genre: 'Shooter',
        playerCount: null,
        coverUrl: 'https://images.igdb.com/igdb/image/upload/t_1080p/halo.jpg',
        images: [],
        platforms: [{ igdbId: 11, name: 'Xbox', abbreviation: 'XBOX' }],
        source: 'IGDB',
        slug: null,
        summary: null,
        rating: null,
        ratingCount: null,
        videos: [],
        raw: expect.anything() as unknown,
      },
    });
  });

  it('maps a real (sanitised) IGDB payload and derives the player count', async () => {
    const search = jest
      .fn<Promise<IgdbGame[]>, [string]>()
      .mockResolvedValue([igdbFixture('halo-game.json')]);
    const resolver = createResolver(search);

    const result = await resolver.resolve(item('Halo: Combat Evolved'));

    expect(result.kind).toBe('matched');
    if (result.kind !== 'matched') return;
    expect(result.candidate).toMatchObject({
      externalId: 1036,
      title: 'Halo: Combat Evolved',
      releaseYear: 2001,
      publisher: 'Bungie',
      genre: 'Shooter',
      // max(onlinemax=16, offlinemax=4, offlinecoopmax=2, onlinecoopmax=4)
      playerCount: 16,
      coverUrl: 'https://images.igdb.com/igdb/image/upload/t_1080p/co61gh.jpg',
      source: 'IGDB',
      summary: expect.stringContaining('Halo') as string,
      rating: 78.4,
      ratingCount: 512,
      videos: [
        { videoId: 'AbCdEfGhIj0', name: 'Trailer' },
        { videoId: 'Zyx_wvu-987', name: 'Gameplay' },
      ],
    });
  });

  it('drops invalid video ids, dedupes, and keeps IGDB order', async () => {
    const search = jest.fn<Promise<IgdbGame[]>, [string]>().mockResolvedValue([
      game({
        id: 3,
        name: 'Halo',
        videos: [
          { id: 1, name: 'Bad', video_id: 'bad' },
          { id: 2, name: 'Url', video_id: 'http://x/aaaaaaaaaaa' },
          { id: 3, name: 'Missing' },
          { id: 4, name: 'First', video_id: 'aaaaaaaaaaa' },
          { id: 5, name: 'Dup', video_id: 'aaaaaaaaaaa' },
          { id: 6, name: 'Second', video_id: 'bbbbbbbbbbb' },
        ],
      }),
    ]);
    const resolver = createResolver(search);

    const result = await resolver.resolve(item('Halo'));

    expect(result.kind).toBe('matched');
    if (result.kind !== 'matched') return;
    expect(result.candidate.videos).toEqual([
      { videoId: 'aaaaaaaaaaa', name: 'First' },
      { videoId: 'bbbbbbbbbbb', name: 'Second' },
    ]);
  });

  it('leaves a missing or blank video name as null', async () => {
    const search = jest.fn<Promise<IgdbGame[]>, [string]>().mockResolvedValue([
      game({
        id: 4,
        name: 'Halo',
        videos: [
          { id: 1, video_id: 'aaaaaaaaaaa' },
          { id: 2, name: '   ', video_id: 'bbbbbbbbbbb' },
        ],
      }),
    ]);
    const resolver = createResolver(search);

    const result = await resolver.resolve(item('Halo'));

    expect(result.kind).toBe('matched');
    if (result.kind !== 'matched') return;
    expect(result.candidate.videos).toEqual([
      { videoId: 'aaaaaaaaaaa', name: null },
      { videoId: 'bbbbbbbbbbb', name: null },
    ]);
  });

  it('normalizes rating to null unless it is a finite 0–100 number', async () => {
    const cases: [unknown, number | null][] = [
      [101, null],
      [-1, null],
      [Number.NaN, null],
      [undefined, null],
      ['78', null],
      [0, 0],
      [100, 100],
      [78.4, 78.4],
    ];
    for (const [rating, expected] of cases) {
      const search = jest
        .fn<Promise<IgdbGame[]>, [string]>()
        .mockResolvedValue([
          game({ id: 5, name: 'Halo', rating: rating as IgdbGame['rating'] }),
        ]);
      const resolver = createResolver(search);
      const result = await resolver.resolve(item('Halo'));
      expect(result.kind).toBe('matched');
      if (result.kind !== 'matched') return;
      expect(result.candidate.rating).toBe(expected);
    }
  });

  it('turns a blank summary into null', async () => {
    const search = jest
      .fn<Promise<IgdbGame[]>, [string]>()
      .mockResolvedValue([game({ id: 6, name: 'Halo', summary: '   ' })]);
    const resolver = createResolver(search);

    const result = await resolver.resolve(item('Halo'));

    expect(result.kind).toBe('matched');
    if (result.kind !== 'matched') return;
    expect(result.candidate.summary).toBeNull();
  });

  it('caps an over-long summary at 16000 characters', async () => {
    const long = 'a'.repeat(20000);
    const search = jest
      .fn<Promise<IgdbGame[]>, [string]>()
      .mockResolvedValue([game({ id: 7, name: 'Halo', summary: long })]);
    const resolver = createResolver(search);

    const result = await resolver.resolve(item('Halo'));

    expect(result.kind).toBe('matched');
    if (result.kind !== 'matched') return;
    expect(result.candidate.summary).toBe(long.slice(0, 16000));
  });

  it('leaves playerCount null when multiplayer modes are absent', async () => {
    const search = jest
      .fn<Promise<IgdbGame[]>, [string]>()
      .mockResolvedValue([game({ id: 4, name: 'Halo' })]);
    const resolver = createResolver(search);

    const result = await resolver.resolve(item('Halo'));

    expect(result.kind).toBe('matched');
    if (result.kind !== 'matched') return;
    expect(result.candidate.playerCount).toBeNull();
  });

  it('orders gallery images artworks-first, then screenshots, normalized', async () => {
    const search = jest.fn<Promise<IgdbGame[]>, [string]>().mockResolvedValue([
      game({
        id: 1,
        name: 'Halo',
        artworks: [
          { url: '//images.igdb.com/igdb/image/upload/t_thumb/art1.jpg' },
        ],
        screenshots: [
          { url: '//images.igdb.com/igdb/image/upload/t_thumb/shot1.jpg' },
        ],
      }),
    ]);
    const resolver = createResolver(search);

    const result = await resolver.resolve(item('Halo'));

    expect(result.kind).toBe('matched');
    if (result.kind !== 'matched') return;
    expect(result.candidate.images).toEqual([
      'https://images.igdb.com/igdb/image/upload/t_1080p/art1.jpg',
      'https://images.igdb.com/igdb/image/upload/t_1080p/shot1.jpg',
    ]);
  });

  it('dedupes gallery images by resolved URL (artworks win)', async () => {
    const search = jest.fn<Promise<IgdbGame[]>, [string]>().mockResolvedValue([
      game({
        id: 1,
        name: 'Halo',
        artworks: [
          { url: '//images.igdb.com/igdb/image/upload/t_thumb/same.jpg' },
        ],
        screenshots: [
          { url: '//images.igdb.com/igdb/image/upload/t_thumb/same.jpg' },
          { url: '//images.igdb.com/igdb/image/upload/t_thumb/other.jpg' },
        ],
      }),
    ]);
    const resolver = createResolver(search);

    const result = await resolver.resolve(item('Halo'));

    expect(result.kind).toBe('matched');
    if (result.kind !== 'matched') return;
    expect(result.candidate.images).toEqual([
      'https://images.igdb.com/igdb/image/upload/t_1080p/same.jpg',
      'https://images.igdb.com/igdb/image/upload/t_1080p/other.jpg',
    ]);
  });

  it('caps the gallery at eight images', async () => {
    const screenshots = Array.from({ length: 10 }, (_, i) => ({
      url: `//images.igdb.com/igdb/image/upload/t_thumb/shot${String(i)}.jpg`,
    }));
    const search = jest
      .fn<Promise<IgdbGame[]>, [string]>()
      .mockResolvedValue([game({ id: 1, name: 'Halo', screenshots })]);
    const resolver = createResolver(search);

    const result = await resolver.resolve(item('Halo'));

    expect(result.kind).toBe('matched');
    if (result.kind !== 'matched') return;
    expect(result.candidate.images).toHaveLength(8);
  });

  it('drops malformed gallery entries and leaves images empty when absent', async () => {
    const search = jest.fn<Promise<IgdbGame[]>, [string]>().mockResolvedValue([
      game({
        id: 1,
        name: 'Halo',
        artworks: [{ url: '' }, {}],
        screenshots: [{ url: 'not-an-igdb-url.jpg' }],
      }),
    ]);
    const resolver = createResolver(search);

    const result = await resolver.resolve(item('Halo'));

    expect(result.kind).toBe('matched');
    if (result.kind !== 'matched') return;
    expect(result.candidate.images).toEqual(['not-an-igdb-url.jpg']);
  });
});

describe('IgdbGameCatalogResolver.resolveBatch (unit)', () => {
  it('resolves N titles in one call, aligned to input order', async () => {
    const multiquery = jest
      .fn<Promise<IgdbGame[][]>, [readonly string[]]>()
      .mockResolvedValue([
        [game({ id: 1, name: 'Halo' })],
        [game({ id: 2, name: 'God of War' })],
      ]);
    const resolver = createBatchResolver(multiquery);

    const results = await resolver.resolveBatch([
      item('Halo'),
      item('Mystery'),
    ]);

    expect(multiquery).toHaveBeenCalledTimes(1);
    expect(multiquery).toHaveBeenCalledWith(['Halo', 'Mystery']);
    expect(results.map((r) => r.kind)).toEqual(['matched', 'unrecognized']);
  });

  it('accepts a candidate that differs by a minor typo', async () => {
    const multiquery = jest
      .fn<Promise<IgdbGame[][]>, [readonly string[]]>()
      .mockResolvedValue([[game({ id: 7, name: 'Halo' })]]);
    const resolver = createBatchResolver(multiquery);

    const results = await resolver.resolveBatch([item('Haloo')]);

    expect(results[0]?.kind).toBe('matched');
  });

  it('reports no plausible match as unrecognized, not a wrong game', async () => {
    const multiquery = jest
      .fn<Promise<IgdbGame[][]>, [readonly string[]]>()
      .mockResolvedValue([[game({ id: 9, name: 'Fifa 23' })]]);
    const resolver = createBatchResolver(multiquery);

    const results = await resolver.resolveBatch([item('Fifa 24')]);

    expect(results[0]).toEqual({
      kind: 'unrecognized',
      reason: 'No IGDB game matched the title',
    });
  });

  it('maps a retryable batch error to transient for every item', async () => {
    const multiquery = jest
      .fn<Promise<IgdbGame[][]>, [readonly string[]]>()
      .mockRejectedValue(new IgdbError(true, 'IGDB rate-limited the request'));
    const resolver = createBatchResolver(multiquery);

    const results = await resolver.resolveBatch([item('Halo'), item('Doom')]);

    expect(results).toEqual([
      { kind: 'transient', reason: 'IGDB rate-limited the request' },
      { kind: 'transient', reason: 'IGDB rate-limited the request' },
    ]);
  });

  it('maps a config batch error to config_error for every item', async () => {
    const multiquery = jest
      .fn<Promise<IgdbGame[][]>, [readonly string[]]>()
      .mockRejectedValue(new IgdbConfigError('IGDB rejected the credentials'));
    const resolver = createBatchResolver(multiquery);

    const results = await resolver.resolveBatch([item('Halo')]);

    expect(results).toEqual([
      {
        kind: 'config_error',
        source: 'igdb',
        reason: 'IGDB rejected the credentials',
      },
    ]);
  });

  it('passes all 11 titles in a single client call (chunking is the client’s)', async () => {
    const titles = Array.from({ length: 11 }, (_, i) => `Game ${String(i)}`);
    const multiquery = jest
      .fn<Promise<IgdbGame[][]>, [readonly string[]]>()
      .mockResolvedValue(Array.from({ length: 11 }, () => []));
    const resolver = createBatchResolver(multiquery);

    const results = await resolver.resolveBatch(titles.map(item));

    expect(multiquery).toHaveBeenCalledTimes(1);
    expect(multiquery).toHaveBeenCalledWith(titles);
    expect(results).toHaveLength(11);
  });

  it('returns [] and makes no client call for an empty list', async () => {
    const multiquery = jest.fn<Promise<IgdbGame[][]>, [readonly string[]]>();
    const resolver = createBatchResolver(multiquery);

    await expect(resolver.resolveBatch([])).resolves.toEqual([]);
    expect(multiquery).not.toHaveBeenCalled();
  });
});

describe('IgdbGameCatalogResolver.search (unit)', () => {
  it('returns ranked candidates (score > 0) with cover and metadata', async () => {
    const search = jest.fn<Promise<IgdbGame[]>, [string]>().mockResolvedValue([
      game({ id: 1, name: 'Halo 2' }),
      game({ id: 2, name: 'Halo Combat Evolved' }),
      game({
        id: 3,
        name: 'Halo',
        first_release_date: 978307200,
        cover: { url: '//images.igdb.com/igdb/image/upload/t_thumb/halo.jpg' },
        involved_companies: [{ company: { name: 'Bungie' } }],
        genres: [{ name: 'Shooter' }],
        platforms: [{ id: 11, name: 'Xbox', abbreviation: 'XBOX' }],
      }),
    ]);
    const resolver = createResolver(search);

    const result = await resolver.search('Halo');

    expect(search).toHaveBeenCalledWith('Halo');
    expect(result.kind).toBe('matches');
    if (result.kind !== 'matches') return;
    // Exact normalized match first; the sequel scores 0 and is dropped.
    expect(result.candidates.map((c) => c.externalId)).toEqual([3, 2]);
    expect(result.candidates[0]).toMatchObject({
      externalId: 3,
      title: 'Halo',
      releaseYear: 2001,
      publisher: 'Bungie',
      genre: 'Shooter',
      coverUrl: 'https://images.igdb.com/igdb/image/upload/t_1080p/halo.jpg',
    });
  });

  it('maps an IgdbConfigError to a config_error result', async () => {
    const search = jest
      .fn<Promise<IgdbGame[]>, [string]>()
      .mockRejectedValue(new IgdbConfigError('IGDB rejected the credentials'));
    const resolver = createResolver(search);

    await expect(resolver.search('Halo')).resolves.toEqual({
      kind: 'config_error',
      source: 'igdb',
      reason: 'IGDB rejected the credentials',
    });
  });

  it('maps a retryable IgdbError to transient', async () => {
    const search = jest
      .fn<Promise<IgdbGame[]>, [string]>()
      .mockRejectedValue(new IgdbError(true, 'IGDB rate-limited the request'));
    const resolver = createResolver(search);

    await expect(resolver.search('Halo')).resolves.toEqual({
      kind: 'transient',
      reason: 'IGDB rate-limited the request',
    });
  });

  it('maps a permanent IgdbError to an empty matches result', async () => {
    const search = jest
      .fn<Promise<IgdbGame[]>, [string]>()
      .mockRejectedValue(new IgdbError(false, 'IGDB malformed query'));
    const resolver = createResolver(search);

    await expect(resolver.search('Halo')).resolves.toEqual({
      kind: 'matches',
      candidates: [],
    });
  });
});
