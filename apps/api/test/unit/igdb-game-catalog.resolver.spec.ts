import {
  IgdbGameCatalogResolver,
  normalizeTitle,
} from '../../src/game-catalog/igdb-game-catalog.resolver';
import { IgdbError } from '../../src/game-catalog/igdb.errors';
import { IgdbClient, type IgdbGame } from '../../src/game-catalog/igdb.client';
import type { RecognizedItem } from '../../src/settings/vision/vision-provider';

function item(title: string): RecognizedItem {
  return { title, edition: null, platform: null, confidence: 0.9 };
}

function game(overrides: Partial<IgdbGame>): IgdbGame {
  return { id: 1, name: 'Halo', ...overrides };
}

function createResolver(
  searchGames: jest.Mock<Promise<IgdbGame[]>, [string]>,
): IgdbGameCatalogResolver {
  return new IgdbGameCatalogResolver({
    searchGames,
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

  it('maps a permanent IgdbError to an unrecognized resolution', async () => {
    const search = jest
      .fn<Promise<IgdbGame[]>, [string]>()
      .mockRejectedValue(new IgdbError(false, 'IGDB rejected the credentials'));
    const resolver = createResolver(search);

    await expect(resolver.resolve(item('Halo'))).resolves.toEqual({
      kind: 'unrecognized',
      reason: 'IGDB rejected the credentials',
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
        coverUrl: 'https://images.igdb.com/igdb/image/upload/t_thumb/halo.jpg',
        platforms: [{ igdbId: 11, name: 'Xbox', abbreviation: 'XBOX' }],
        raw: expect.anything() as unknown,
      },
    });
  });
});
