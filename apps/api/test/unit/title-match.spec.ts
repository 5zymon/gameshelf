import {
  CONFIDENT_MATCH_MIN_SCORE,
  normalizeTitle,
  rankTitleMatches,
  selectConfidentMatch,
  titleSimilarity,
} from '../../src/game-catalog/title-match';

/** Round a score to three decimals so assertions are readable. */
function score(a: string, b: string): number {
  return Math.round(titleSimilarity(a, b) * 1000) / 1000;
}

describe('titleSimilarity (unit)', () => {
  it('scores an exact normalized match 1', () => {
    expect(titleSimilarity('Halo', 'Halo')).toBe(1);
    expect(titleSimilarity('Pokémon: Red!', 'pokemon red')).toBe(1);
  });

  it('tolerates a single-character insertion typo at 0.8', () => {
    expect(score('Haloo', 'Halo')).toBe(0.8);
    expect(titleSimilarity('Haloo', 'Halo')).toBeGreaterThanOrEqual(
      CONFIDENT_MATCH_MIN_SCORE,
    );
  });

  it('tolerates a single-character substitution typo', () => {
    expect(score('Pokeman', 'Pokemon')).toBeGreaterThanOrEqual(0.8);
  });

  it('tolerates a transposition typo', () => {
    expect(
      score('Halo Comabt Evolved', 'Halo Combat Evolved'),
    ).toBeGreaterThanOrEqual(0.8);
  });

  it('scores an unrelated title below the threshold', () => {
    expect(titleSimilarity('Halo', 'God of War')).toBeLessThan(
      CONFIDENT_MATCH_MIN_SCORE,
    );
  });

  it('does not treat a short title inside a long one as a match', () => {
    expect(titleSimilarity('Halo', 'Halo Combat Evolved')).toBeLessThan(
      CONFIDENT_MATCH_MIN_SCORE,
    );
  });

  it('guards numeric sequels (never a typo)', () => {
    expect(titleSimilarity('Fifa 24', 'Fifa 23')).toBe(0);
  });

  it('guards roman-numeral sequels', () => {
    expect(titleSimilarity('Grand Theft Auto V', 'Grand Theft Auto IV')).toBe(
      0,
    );
  });

  it('guards an edition/version suffix', () => {
    expect(titleSimilarity('Halo', 'Halo 2')).toBe(0);
  });

  it('scores a blank normalized title as 0', () => {
    expect(titleSimilarity('   ', 'Halo')).toBe(0);
    expect(titleSimilarity('Halo', '---')).toBe(0);
  });
});

describe('rankTitleMatches (unit)', () => {
  it('ranks the highest-similarity candidate first', () => {
    const ranked = rankTitleMatches('Haloo', [
      { name: 'God of War' },
      { name: 'Halo' },
    ]);

    expect(ranked[0]?.game.name).toBe('Halo');
    expect(ranked[0]?.score).toBeGreaterThanOrEqual(CONFIDENT_MATCH_MIN_SCORE);
  });

  it('keeps the original order for equal scores (stable sort)', () => {
    const ranked = rankTitleMatches('Halo', [
      { name: 'Halo', id: 'first' },
      { name: 'Halo', id: 'second' },
    ]);

    expect(ranked).toHaveLength(2);
    expect(ranked.every((entry) => entry.score === 1)).toBe(true);
    expect(ranked.map((entry) => entry.game.id)).toEqual(['first', 'second']);
  });
});

describe('selectConfidentMatch (unit)', () => {
  it('picks the top candidate when it clears the threshold', () => {
    const match = selectConfidentMatch('Haloo', [
      { name: 'God of War' },
      { name: 'Halo' },
    ]);

    expect(match?.game.name).toBe('Halo');
  });

  it('returns null for no candidates', () => {
    expect(selectConfidentMatch('Halo', [])).toBeNull();
  });

  it('returns null when only a version-divergent candidate exists', () => {
    expect(selectConfidentMatch('Fifa 24', [{ name: 'Fifa 23' }])).toBeNull();
  });

  it('returns null when the best candidate is below the threshold', () => {
    expect(
      selectConfidentMatch('Halo', [{ name: 'Halo Combat Evolved' }]),
    ).toBeNull();
  });
});

describe('cross-system version tokens (m4, unit)', () => {
  it('scores a numeral and its roman-numeral form 0 (guarded false negative)', () => {
    expect(titleSimilarity('GTA 5', 'GTA V')).toBe(0);
    expect(titleSimilarity('Final Fantasy 7', 'Final Fantasy VII')).toBe(0);
  });

  it('never resolves a cross-system numeral as a confident match', () => {
    expect(selectConfidentMatch('GTA 5', [{ name: 'GTA V' }])).toBeNull();
  });
});

describe('normalizeTitle (unit)', () => {
  it('lowercases, strips diacritics/punctuation, and collapses spaces', () => {
    expect(normalizeTitle('  Pokémon:  Édition   Rouge! ')).toBe(
      'pokemon edition rouge',
    );
  });
});
