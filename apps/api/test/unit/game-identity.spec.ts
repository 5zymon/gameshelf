import {
  GAME_ALREADY_IN_CATALOG,
  isSameGameIdentity,
  normalizeEdition,
  type GameIdentity,
} from '../../src/games/game-identity';

function linked(overrides: Partial<GameIdentity> = {}): GameIdentity {
  return {
    title: 'Halo',
    platformId: 1,
    edition: null,
    source: 'IGDB',
    externalId: 1036,
    ...overrides,
  };
}

function manual(overrides: Partial<GameIdentity> = {}): GameIdentity {
  return {
    title: 'Halo',
    platformId: 1,
    edition: null,
    source: 'MANUAL',
    externalId: null,
    ...overrides,
  };
}

describe('normalizeEdition (unit)', () => {
  it('returns null for null, undefined, and whitespace-only input', () => {
    expect(normalizeEdition(null)).toBeNull();
    expect(normalizeEdition(undefined)).toBeNull();
    expect(normalizeEdition('   ')).toBeNull();
  });

  it('normalizes case, diacritics, and punctuation', () => {
    expect(normalizeEdition('  GOTY  Édition! ')).toBe('goty edition');
  });
});

describe('GAME_ALREADY_IN_CATALOG (unit)', () => {
  it('is a stable machine-readable code', () => {
    expect(GAME_ALREADY_IN_CATALOG).toBe('GAME_ALREADY_IN_CATALOG');
  });
});

describe('isSameGameIdentity (unit)', () => {
  it('matches two linked games on the same source + external record', () => {
    expect(isSameGameIdentity(linked(), linked({ title: 'Renamed' }))).toBe(
      true,
    );
  });

  it('rejects linked games with a different externalId', () => {
    expect(isSameGameIdentity(linked(), linked({ externalId: 999 }))).toBe(
      false,
    );
  });

  it('rejects linked games from different sources', () => {
    expect(isSameGameIdentity(linked(), linked({ source: 'MobyGames' }))).toBe(
      false,
    );
  });

  it('matches a linked game and an unlinked manual row by normalized title (symmetric)', () => {
    expect(
      isSameGameIdentity(linked({ title: 'Halo' }), manual({ title: 'HALO' })),
    ).toBe(true);
    expect(
      isSameGameIdentity(manual({ title: 'HALO' }), linked({ title: 'Halo' })),
    ).toBe(true);
  });

  it('matches two unlinked games on normalized title, platform, and edition', () => {
    const a = manual({
      title: 'Pokémon:  Édition   Rouge!',
      edition: 'GOTY Edition',
    });
    const b = manual({
      title: 'pokemon edition rouge',
      edition: 'goty edition',
    });
    expect(isSameGameIdentity(a, b)).toBe(true);
  });

  it('treats a blank and a null edition as the same identity input', () => {
    expect(
      isSameGameIdentity(
        manual({ title: 'Halo', edition: '   ' }),
        manual({ title: 'Halo', edition: null }),
      ),
    ).toBe(true);
  });

  it('rejects a different platform', () => {
    expect(isSameGameIdentity(manual(), manual({ platformId: 2 }))).toBe(false);
  });

  it('rejects a different edition (GOTY vs null)', () => {
    expect(isSameGameIdentity(manual(), manual({ edition: 'GOTY' }))).toBe(
      false,
    );
  });

  it('rejects a different normalized title for unlinked games', () => {
    expect(
      isSameGameIdentity(
        manual({ title: 'Halo' }),
        manual({ title: 'Halo 2' }),
      ),
    ).toBe(false);
  });
});
