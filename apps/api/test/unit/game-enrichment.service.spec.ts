import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CatalogCandidate } from '../../src/game-catalog/game-catalog.resolver';
import { IgdbGameCatalogResolver } from '../../src/game-catalog/igdb-game-catalog.resolver';
import { IgdbClient, type IgdbGame } from '../../src/game-catalog/igdb.client';
import { CoverCacheService } from '../../src/covers/cover-cache.service';
import { GameEnrichmentService } from '../../src/enrichment/game-enrichment.service';

const NORMALIZED_COVER =
  'https://images.igdb.com/igdb/image/upload/t_thumb/co61gh.jpg';

function igdbFixture(): IgdbGame {
  return JSON.parse(
    readFileSync(
      join(__dirname, '..', 'fixtures', 'igdb', 'halo-game.json'),
      'utf8',
    ),
  ) as IgdbGame;
}

function coverHash(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 32);
}

interface Harness {
  service: GameEnrichmentService;
  cache: { cacheFromUrl: jest.Mock };
}

function createHarness(served: string | null): Harness {
  const cache = { cacheFromUrl: jest.fn(() => Promise.resolve(served)) };
  return {
    service: new GameEnrichmentService(cache as unknown as CoverCacheService),
    cache,
  };
}

/** Runs a raw IGDB game through the real resolver to get a candidate. */
async function resolveCandidate(
  fixture: IgdbGame,
  title: string,
): Promise<CatalogCandidate> {
  const resolver = new IgdbGameCatalogResolver({
    searchGames: jest.fn(() => Promise.resolve([fixture])),
  } as unknown as IgdbClient);
  const resolution = await resolver.resolve({
    title,
    edition: null,
    platform: null,
    confidence: 0.9,
  });
  if (resolution.kind !== 'matched') {
    throw new Error('expected the fixture to match');
  }
  return resolution.candidate;
}

describe('GameEnrichmentService (unit)', () => {
  it('maps a real (sanitised) IGDB candidate onto Game data with a local cover', async () => {
    const fixture = igdbFixture();
    const candidate = await resolveCandidate(fixture, 'Halo: Combat Evolved');
    const hash = coverHash(NORMALIZED_COVER);
    const h = createHarness(`/api/covers/${hash}.jpg`);

    const data = await h.service.enrichCandidate(candidate, 3, 'Standard');

    expect(data).toEqual({
      title: 'Halo: Combat Evolved',
      platformId: 3,
      edition: 'Standard',
      releaseYear: 2001,
      publisher: 'Bungie',
      genre: 'Shooter',
      playerCount: 16,
      coverUrl: `/api/covers/${hash}.jpg`,
      sourceCoverUrl: NORMALIZED_COVER,
      rawMetadata: JSON.stringify(fixture),
      enrichedAt: expect.any(Date) as Date,
      source: 'IGDB',
      externalId: 1036,
    });
    expect(data.enrichedAt).toBeInstanceOf(Date);
    // The raw upstream payload is archived verbatim into the archival column.
    expect(JSON.parse(data.rawMetadata)).toEqual(fixture);
    // The cover is resolved from the (normalized) external URL to a local path.
    expect(h.cache.cacheFromUrl).toHaveBeenCalledWith(NORMALIZED_COVER);
  });

  it('keeps every field null when the source provides nothing (no invented values)', async () => {
    const candidate = await resolveCandidate(
      { id: 5, name: 'Mystery' },
      'Mystery',
    );
    const h = createHarness(null);

    const data = await h.service.enrichCandidate(candidate, 9, null);

    expect(data).toEqual({
      title: 'Mystery',
      platformId: 9,
      edition: null,
      releaseYear: null,
      publisher: null,
      genre: null,
      playerCount: null,
      coverUrl: null,
      sourceCoverUrl: null,
      rawMetadata: JSON.stringify({ id: 5, name: 'Mystery' }),
      enrichedAt: expect.any(Date) as Date,
      source: 'IGDB',
      externalId: 5,
    });
  });

  it('saves the game with a null coverUrl when the cover download fails', async () => {
    const fixture = igdbFixture();
    const candidate = await resolveCandidate(fixture, 'Halo: Combat Evolved');
    const h = createHarness(null);

    const data = await h.service.enrichCandidate(candidate, 3, null);

    expect(data.coverUrl).toBeNull();
    // A failed cover must not drop the rest of the mapping.
    expect(data.title).toBe('Halo: Combat Evolved');
    expect(data.publisher).toBe('Bungie');
  });

  it('takes the edition from the vision item only, never from the API payload', async () => {
    // `version_parent` is IGDB's edition/version link; it must not become an
    // edition value.
    const fixture: IgdbGame = { ...igdbFixture(), version_parent: 1036 };
    const candidate = await resolveCandidate(fixture, 'Halo: Combat Evolved');
    const h = createHarness(null);

    const data = await h.service.enrichCandidate(candidate, 3, null);

    expect(data.edition).toBeNull();
  });
});
