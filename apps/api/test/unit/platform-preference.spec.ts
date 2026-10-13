import type { CatalogCandidate } from '../../src/game-catalog/game-catalog.resolver';
import {
  candidateRunsOn,
  preferPlatform,
  type PreferredPlatform,
} from '../../src/import-jobs/platform-preference';
import { testId } from '../helpers/ids';

function candidate(
  overrides: Partial<CatalogCandidate> = {},
): CatalogCandidate {
  return {
    externalId: 1,
    title: 'Game',
    releaseYear: null,
    publisher: null,
    genre: null,
    playerCount: null,
    coverUrl: null,
    images: [],
    platforms: [],
    source: 'IGDB',
    raw: {},
    ...overrides,
  };
}

const PC: PreferredPlatform = {
  id: testId(10),
  name: 'PC (Microsoft Windows)',
  abbreviation: 'PC',
  alternativeName: null,
  igdbId: 6,
};

const XBOX: CatalogCandidate = candidate({
  externalId: 1,
  title: 'Xbox only',
  platforms: [{ igdbId: 12, name: 'Xbox', abbreviation: 'XBOX' }],
});
const PC_BY_IGDB_ID: CatalogCandidate = candidate({
  externalId: 2,
  title: 'PC by igdb id',
  platforms: [{ igdbId: 6, name: 'Personal Computer', abbreviation: null }],
});
const PC_BY_NAME: CatalogCandidate = candidate({
  externalId: 3,
  title: 'PC by name',
  platforms: [
    { igdbId: 999, name: 'PC (Microsoft Windows)', abbreviation: 'PC' },
  ],
});
const PC_BY_ABBREVIATION: CatalogCandidate = candidate({
  externalId: 4,
  title: 'PC by abbreviation',
  platforms: [{ igdbId: null, name: 'Personal Computer', abbreviation: 'PC' }],
});

describe('candidateRunsOn', () => {
  it('matches on the platform IGDB id', () => {
    expect(candidateRunsOn(PC_BY_IGDB_ID, PC)).toBe(true);
  });

  it('matches on the anchored platform name when the id differs', () => {
    expect(candidateRunsOn(PC_BY_NAME, PC)).toBe(true);
  });

  it('matches on the abbreviation when the id is unknown', () => {
    expect(candidateRunsOn(PC_BY_ABBREVIATION, PC)).toBe(true);
  });

  it('does not match a candidate on another platform', () => {
    expect(candidateRunsOn(XBOX, PC)).toBe(false);
    expect(candidateRunsOn(candidate(), PC)).toBe(false);
  });
});

describe('preferPlatform', () => {
  it('returns a copy in catalog order when there is no platform', () => {
    const candidates = [XBOX, PC_BY_IGDB_ID];
    const result = preferPlatform(candidates, null);
    expect(result).toEqual(candidates);
    expect(result).not.toBe(candidates);
  });

  it('puts platform matches first and keeps catalog order within groups', () => {
    const candidates = [XBOX, PC_BY_IGDB_ID, PC_BY_NAME];
    const result = preferPlatform(candidates, PC);
    expect(result.map((c) => c.externalId)).toEqual([2, 3, 1]);
  });

  it('is stable for candidates that all match', () => {
    const candidates = [PC_BY_ABBREVIATION, PC_BY_NAME, PC_BY_IGDB_ID];
    const result = preferPlatform(candidates, PC);
    expect(result.map((c) => c.externalId)).toEqual([4, 3, 2]);
  });
});
