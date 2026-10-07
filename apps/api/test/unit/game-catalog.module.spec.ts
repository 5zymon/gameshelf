import { ChainedGameCatalogResolver } from '../../src/game-catalog/chained-game-catalog.resolver';
import { catalogSourceList } from '../../src/game-catalog/game-catalog.module';
import type {
  CatalogResolution,
  GameCatalogSource,
} from '../../src/game-catalog/game-catalog.resolver';
import type { RecognizedItem } from '../../src/settings/vision/vision-provider';

const igdb = { label: 'IGDB' } as GameCatalogSource;
const mobygames = { label: 'MobyGames' } as GameCatalogSource;

function item(title: string): RecognizedItem {
  return { title, edition: null, platform: null, confidence: 0.9 };
}

describe('catalogSourceList (unit)', () => {
  it('returns [igdb] when MobyGames is unconfigured', () => {
    expect(catalogSourceList(igdb, mobygames, false)).toEqual([igdb]);
  });

  it('returns [igdb, mobygames] when MobyGames is configured', () => {
    expect(catalogSourceList(igdb, mobygames, true)).toEqual([igdb, mobygames]);
  });
});

describe('IGDB-only chain (AC4)', () => {
  it('reports IGDB as the only source and never mentions MobyGames', async () => {
    const igdbResolve = jest
      .fn<Promise<CatalogResolution>, [RecognizedItem]>()
      .mockResolvedValue({
        kind: 'unrecognized',
        reason: 'No IGDB game matched the title',
      });
    const resolver = new ChainedGameCatalogResolver([
      { label: 'IGDB', resolve: igdbResolve, search: jest.fn() },
    ]);

    const result = await resolver.resolve(item('Zorblax'));

    expect(result).toEqual({
      kind: 'unrecognized',
      reason:
        'No game matched the title in any source — IGDB: No IGDB game matched the title',
    });
    expect(JSON.stringify(result)).not.toContain('MobyGames');
  });
});
