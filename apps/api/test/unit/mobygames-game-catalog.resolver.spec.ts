import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MobygamesConfigError,
  MobygamesError,
} from '../../src/game-catalog/mobygames.errors';
import {
  MobygamesClient,
  type MobygameGame,
} from '../../src/game-catalog/mobygames.client';
import { MobygamesGameCatalogResolver } from '../../src/game-catalog/mobygames-game-catalog.resolver';
import type { RecognizedItem } from '../../src/settings/vision/vision-provider';

function item(title: string): RecognizedItem {
  return { title, edition: null, platform: null, confidence: 0.9 };
}

function game(overrides: Partial<MobygameGame>): MobygameGame {
  return { game_id: 1, title: 'Halo', ...overrides };
}

/** Loads a real (sanitised) MobyGames payload from `test/fixtures/mobygames`. */
function mobygamesFixture(name: string): MobygameGame {
  return JSON.parse(
    readFileSync(join(__dirname, '..', 'fixtures', 'mobygames', name), 'utf8'),
  ) as MobygameGame;
}

type SearchMock = jest.Mock<Promise<MobygameGame[]>, [string]>;

function createResolver(searchGames: SearchMock): MobygamesGameCatalogResolver {
  return new MobygamesGameCatalogResolver({
    searchGames,
  } as unknown as MobygamesClient);
}

describe('MobygamesGameCatalogResolver (unit)', () => {
  it('has the label MobyGames', () => {
    const search = jest.fn<Promise<MobygameGame[]>, [string]>();
    const resolver = createResolver(search);
    expect(resolver.label).toBe('MobyGames');
  });

  it('maps a matched game onto CatalogCandidate', async () => {
    const search = jest
      .fn<Promise<MobygameGame[]>, [string]>()
      .mockResolvedValue([
        game({
          game_id: 42,
          title: 'Halo',
          genres: [{ id: 1, name: 'Shooter' }],
          covers: [
            { images: [{ image_url: 'https://cdn.mobygames.com/halo.jpg' }] },
          ],
          platforms: [
            {
              platform_id: 5,
              name: 'Xbox',
              release_date: '2001-11-15',
              releases: [
                {
                  release_date: '2001-11-15',
                  companies: [
                    {
                      company_id: 9,
                      company_name: 'Bungie',
                      role: 'Published by',
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ]);
    const resolver = createResolver(search);

    const result = await resolver.resolve(item('Halo'));

    expect(result).toEqual({
      kind: 'matched',
      candidate: {
        externalId: 42,
        title: 'Halo',
        releaseYear: 2001,
        publisher: 'Bungie',
        genre: 'Shooter',
        playerCount: null,
        coverUrl: 'https://cdn.mobygames.com/halo.jpg',
        platforms: [{ igdbId: null, name: 'Xbox', abbreviation: null }],
        source: 'MobyGames',
        raw: expect.anything() as unknown,
      },
    });
  });

  it('maps a real (sanitised) MobyGames payload with playerCount null', async () => {
    const search = jest
      .fn<Promise<MobygameGame[]>, [string]>()
      .mockResolvedValue([mobygamesFixture('halo-game.json')]);
    const resolver = createResolver(search);

    const result = await resolver.resolve(item('Halo: Combat Evolved'));

    expect(result).toEqual({
      kind: 'matched',
      candidate: {
        externalId: 1201,
        title: 'Halo: Combat Evolved',
        releaseYear: 2001,
        publisher: 'Microsoft Game Studios',
        genre: 'Action',
        // The v2 search `include` exposes no player count; inventing one is
        // forbidden, so this stays null.
        playerCount: null,
        coverUrl:
          'https://cdn.mobygames.com/covers/4074-halo-combat-evolved-xbox-front-cover.jpg',
        platforms: [{ igdbId: null, name: 'Xbox', abbreviation: null }],
        source: 'MobyGames',
        raw: expect.anything() as unknown,
      },
    });
  });

  it('derives releaseYear and publisher from platforms/releases', async () => {
    const search = jest
      .fn<Promise<MobygameGame[]>, [string]>()
      .mockResolvedValue([
        game({
          game_id: 7,
          title: 'Obscure Gem',
          platforms: [
            {
              name: 'PC',
              release_date: '2003',
              releases: [
                {
                  release_date: '2003-06-01',
                  companies: [
                    { company_name: 'Publisher B', role: 'Published by' },
                  ],
                },
              ],
            },
            {
              name: 'Xbox',
              release_date: '2001-11-15',
              releases: [
                {
                  companies: [{ company_name: 'Dev Co', role: 'Developed by' }],
                },
              ],
            },
          ],
        }),
      ]);
    const resolver = createResolver(search);

    const result = await resolver.resolve(item('Obscure Gem'));

    expect(result.kind).toBe('matched');
    if (result.kind !== 'matched') return;
    expect(result.candidate.releaseYear).toBe(2001);
    expect(result.candidate.publisher).toBe('Publisher B');
  });

  it('maps a malformed nested payload to unrecognized rather than throwing', async () => {
    const malformed = game({});
    // An unexpected shape that would throw during mapping even after the
    // null-element guards: the mapping step must still degrade to unrecognized.
    Object.defineProperty(malformed, 'platforms', {
      get: () => {
        throw new TypeError('malformed platforms');
      },
    });
    const search = jest
      .fn<Promise<MobygameGame[]>, [string]>()
      .mockResolvedValue([malformed]);
    const resolver = createResolver(search);

    await expect(resolver.resolve(item('Halo'))).resolves.toEqual({
      kind: 'unrecognized',
      reason: 'MobyGames returned a malformed game payload',
    });
  });

  it('maps null nested elements to a matched candidate with empty fields rather than throwing', async () => {
    const search = jest
      .fn<Promise<MobygameGame[]>, [string]>()
      .mockResolvedValue([
        game({
          game_id: 99,
          genres: [null],
          platforms: [
            null,
            { name: 'Xbox', releases: [null, { companies: [null] }] },
          ],
          covers: [null, { images: [null] }],
        } as unknown as Partial<MobygameGame>),
      ]);
    const resolver = createResolver(search);

    await expect(resolver.resolve(item('Halo'))).resolves.toEqual({
      kind: 'matched',
      candidate: {
        externalId: 99,
        title: 'Halo',
        releaseYear: null,
        publisher: null,
        genre: null,
        playerCount: null,
        coverUrl: null,
        platforms: [{ igdbId: null, name: 'Xbox', abbreviation: null }],
        source: 'MobyGames',
        raw: expect.anything() as unknown,
      },
    });
  });

  it('falls back to the first company name when no publisher role is present', async () => {
    const search = jest
      .fn<Promise<MobygameGame[]>, [string]>()
      .mockResolvedValue([
        game({
          title: 'Halo',
          platforms: [
            {
              name: 'Xbox',
              releases: [
                {
                  companies: [
                    { company_name: 'Some Studio', role: 'Developed by' },
                  ],
                },
              ],
            },
          ],
        }),
      ]);
    const resolver = createResolver(search);

    const result = await resolver.resolve(item('Halo'));

    expect(result.kind).toBe('matched');
    if (result.kind !== 'matched') return;
    expect(result.candidate.publisher).toBe('Some Studio');
    expect(result.candidate.releaseYear).toBeNull();
  });

  it('returns unrecognized when nothing is confident', async () => {
    const search = jest
      .fn<Promise<MobygameGame[]>, [string]>()
      .mockResolvedValue([game({ title: 'Completely Different' })]);
    const resolver = createResolver(search);

    await expect(resolver.resolve(item('Zorblax'))).resolves.toEqual({
      kind: 'unrecognized',
      reason: 'No MobyGames game matched the title',
    });
  });

  it('does not match a sequel/version as a typo', async () => {
    const search = jest
      .fn<Promise<MobygameGame[]>, [string]>()
      .mockResolvedValue([game({ title: 'Halo 2' })]);
    const resolver = createResolver(search);

    await expect(resolver.resolve(item('Halo'))).resolves.toEqual({
      kind: 'unrecognized',
      reason: 'No MobyGames game matched the title',
    });
  });

  it('maps MobygamesConfigError to config_error source mobygames', async () => {
    const search = jest
      .fn<Promise<MobygameGame[]>, [string]>()
      .mockRejectedValue(
        new MobygamesConfigError('MobyGames rejected the credentials'),
      );
    const resolver = createResolver(search);

    await expect(resolver.resolve(item('Halo'))).resolves.toEqual({
      kind: 'config_error',
      source: 'mobygames',
      reason: 'MobyGames rejected the credentials',
    });
  });

  it('maps a retryable MobygamesError to transient', async () => {
    const search = jest
      .fn<Promise<MobygameGame[]>, [string]>()
      .mockRejectedValue(
        new MobygamesError(true, 'MobyGames rate-limited the request'),
      );
    const resolver = createResolver(search);

    await expect(resolver.resolve(item('Halo'))).resolves.toEqual({
      kind: 'transient',
      reason: 'MobyGames rate-limited the request',
    });
  });

  it('maps a permanent MobygamesError to unrecognized', async () => {
    const search = jest
      .fn<Promise<MobygameGame[]>, [string]>()
      .mockRejectedValue(new MobygamesError(false, 'MobyGames malformed'));
    const resolver = createResolver(search);

    await expect(resolver.resolve(item('Halo'))).resolves.toEqual({
      kind: 'unrecognized',
      reason: 'MobyGames malformed',
    });
  });

  it('inherits sequential resolveBatch (one resolve per item, in order)', async () => {
    const search = jest
      .fn<Promise<MobygameGame[]>, [string]>()
      .mockResolvedValue([]);
    const resolver = createResolver(search);

    const results = await resolver.resolveBatch([
      item('First'),
      item('Second'),
    ]);

    expect(results).toEqual([
      { kind: 'unrecognized', reason: 'No MobyGames game matched the title' },
      { kind: 'unrecognized', reason: 'No MobyGames game matched the title' },
    ]);
    expect(search.mock.calls.map(([title]) => title)).toEqual([
      'First',
      'Second',
    ]);
  });
});
