import {
  findPlatformMatch,
  normalizePlatformName,
  type PlatformMatchCandidate,
} from '../../src/platforms/platform-match';

/** Builds a candidate with sensible null defaults. */
function candidate(
  overrides: Partial<PlatformMatchCandidate> & { id: number },
): PlatformMatchCandidate {
  return {
    name: '',
    abbreviation: null,
    alternativeName: null,
    ...overrides,
  };
}

describe('normalizePlatformName (unit)', () => {
  it('lowercases and leaves an already-normal name in place', () => {
    expect(normalizePlatformName('PS5')).toBe('ps5');
  });

  it('trims and collapses internal whitespace', () => {
    expect(normalizePlatformName('  PlayStation   5 ')).toBe('playstation 5');
  });

  it('strips diacritics', () => {
    expect(normalizePlatformName('Święta')).toBe('swieta');
  });

  it('drops punctuation such as ®', () => {
    expect(normalizePlatformName('Nintendo® Switch')).toBe('nintendo switch');
  });

  it('rewrites punctuation to a single space', () => {
    expect(normalizePlatformName('PlayStation-5')).toBe('playstation 5');
  });

  it('expands & to "and"', () => {
    expect(normalizePlatformName('Rock & Roll')).toBe('rock and roll');
  });

  it('reduces a punctuation-only value to the empty string', () => {
    expect(normalizePlatformName('!!!')).toBe('');
  });
});

describe('findPlatformMatch (unit)', () => {
  it('matches PS5 to a platform whose abbreviation is PS5', () => {
    const ps5 = candidate({
      id: 1,
      name: 'PlayStation 5',
      abbreviation: 'PS5',
    });

    expect(findPlatformMatch([ps5], ['PS5'])).toBe(ps5);
  });

  it("resolves 'PS5' and 'PlayStation 5' to the same record", () => {
    const ps5 = candidate({
      id: 1,
      name: 'PlayStation 5',
      abbreviation: 'PS5',
    });

    expect(findPlatformMatch([ps5], ['PS5'])).toBe(ps5);
    expect(findPlatformMatch([ps5], ['PlayStation 5'])).toBe(ps5);
  });

  it('matches through a platform alternative name', () => {
    const ps5 = candidate({
      id: 1,
      name: 'Sony PlayStation 5',
      alternativeName: 'PS5',
    });

    expect(findPlatformMatch([ps5], ['PS5'])).toBe(ps5);
  });

  it('is case-insensitive', () => {
    const platform = candidate({ id: 1, name: 'PlayStation 5' });

    expect(findPlatformMatch([platform], ['playstation 5'])).toBe(platform);
  });

  it('ignores punctuation and whitespace differences', () => {
    const platform = candidate({ id: 1, name: 'Nintendo Switch' });

    expect(findPlatformMatch([platform], ['nintendo-switch'])).toBe(platform);
  });

  it('returns the match for the first input that resolves', () => {
    const alpha = candidate({ id: 1, name: 'Alpha' });
    const beta = candidate({ id: 2, name: 'Beta' });

    expect(findPlatformMatch([alpha, beta], ['Beta', 'Alpha'])).toBe(beta);
  });

  it('does not force-match a near-miss name', () => {
    const ps5 = candidate({
      id: 1,
      name: 'PlayStation 5',
      abbreviation: 'PS5',
    });

    expect(findPlatformMatch([ps5], ['PlayStation 4'])).toBeNull();
  });

  it('does not force-match a near-miss abbreviation', () => {
    const ps5 = candidate({
      id: 1,
      name: 'PlayStation 5',
      abbreviation: 'PS5',
    });

    expect(findPlatformMatch([ps5], ['PS4'])).toBeNull();
  });

  it('does not force-match a shorter name against a longer one', () => {
    const xbox = candidate({ id: 1, name: 'Xbox' });

    expect(findPlatformMatch([xbox], ['Xbox 360'])).toBeNull();
  });

  it('returns null when no input is known', () => {
    const ps5 = candidate({ id: 1, name: 'PlayStation 5' });

    expect(findPlatformMatch([ps5], ['Atari Jaguar', 'Dreamcast'])).toBeNull();
  });

  it('never matches a key shared by two distinct platforms', () => {
    const a = candidate({ id: 1, name: 'Shared' });
    const b = candidate({ id: 2, name: 'Other', abbreviation: 'Shared' });

    expect(findPlatformMatch([a, b], ['Shared'])).toBeNull();
  });

  it('matches through an alias', () => {
    const ps5 = candidate({
      id: 1,
      name: 'PlayStation 5',
      aliases: ['PlayStaton 5'],
    });

    expect(findPlatformMatch([ps5], ['PlayStaton 5'])).toBe(ps5);
  });

  it('never matches an alias key shared by two distinct platforms', () => {
    const a = candidate({ id: 1, name: 'Alpha', aliases: ['Shared'] });
    const b = candidate({ id: 2, name: 'Beta', aliases: ['Shared'] });

    expect(findPlatformMatch([a, b], ['Shared'])).toBeNull();
  });

  it('treats a platform without aliases as a valid candidate (regression)', () => {
    const ps5 = candidate({ id: 1, name: 'PlayStation 5' });

    expect(findPlatformMatch([ps5], ['PlayStation 5'])).toBe(ps5);
  });

  it('skips null, undefined, and blank inputs', () => {
    const platform = candidate({ id: 1, name: 'Alpha' });

    expect(
      findPlatformMatch([platform], [null, undefined, '', '   ', 'Alpha']),
    ).toBe(platform);
  });
});
