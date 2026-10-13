import {
  expandPlatformInputs,
  findPlatformMatch,
  normalizePlatformName,
  type PlatformMatchCandidate,
} from '../../src/platforms/platform-match';
import { testId } from '../helpers/ids';

/** Builds a candidate with sensible null defaults. */
function candidate(
  overrides: Partial<PlatformMatchCandidate> & { id: string },
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

describe('expandPlatformInputs (unit)', () => {
  it('expands a PC DVD ROM banner to the canonical equivalents, then the literal input', () => {
    const expanded = expandPlatformInputs('PC DVD ROM');

    expect(expanded[0]).toBe('PC');
    expect(expanded).toContain('PC (Microsoft Windows)');
    expect(expanded[expanded.length - 1]).toBe('PC DVD ROM');
  });

  it('leaves a near-miss PC name untouched', () => {
    expect(expandPlatformInputs('PC Engine')).toEqual(['PC Engine']);
  });

  it('leaves a bare PC input untouched', () => {
    expect(expandPlatformInputs('PC')).toEqual(['PC']);
  });
});

describe('findPlatformMatch (unit)', () => {
  it('matches PS5 to a platform whose abbreviation is PS5', () => {
    const ps5 = candidate({
      id: testId(1),
      name: 'PlayStation 5',
      abbreviation: 'PS5',
    });

    expect(findPlatformMatch([ps5], ['PS5'])).toBe(ps5);
  });

  it("resolves 'PS5' and 'PlayStation 5' to the same record", () => {
    const ps5 = candidate({
      id: testId(1),
      name: 'PlayStation 5',
      abbreviation: 'PS5',
    });

    expect(findPlatformMatch([ps5], ['PS5'])).toBe(ps5);
    expect(findPlatformMatch([ps5], ['PlayStation 5'])).toBe(ps5);
  });

  it('matches through a platform alternative name', () => {
    const ps5 = candidate({
      id: testId(1),
      name: 'Sony PlayStation 5',
      alternativeName: 'PS5',
    });

    expect(findPlatformMatch([ps5], ['PS5'])).toBe(ps5);
  });

  it('is case-insensitive', () => {
    const platform = candidate({ id: testId(1), name: 'PlayStation 5' });

    expect(findPlatformMatch([platform], ['playstation 5'])).toBe(platform);
  });

  it('ignores punctuation and whitespace differences', () => {
    const platform = candidate({ id: testId(1), name: 'Nintendo Switch' });

    expect(findPlatformMatch([platform], ['nintendo-switch'])).toBe(platform);
  });

  it('returns the match for the first input that resolves', () => {
    const alpha = candidate({ id: testId(1), name: 'Alpha' });
    const beta = candidate({ id: testId(2), name: 'Beta' });

    expect(findPlatformMatch([alpha, beta], ['Beta', 'Alpha'])).toBe(beta);
  });

  it('does not force-match a near-miss name', () => {
    const ps5 = candidate({
      id: testId(1),
      name: 'PlayStation 5',
      abbreviation: 'PS5',
    });

    expect(findPlatformMatch([ps5], ['PlayStation 4'])).toBeNull();
  });

  it('does not force-match a near-miss abbreviation', () => {
    const ps5 = candidate({
      id: testId(1),
      name: 'PlayStation 5',
      abbreviation: 'PS5',
    });

    expect(findPlatformMatch([ps5], ['PS4'])).toBeNull();
  });

  it('does not force-match a shorter name against a longer one', () => {
    const xbox = candidate({ id: testId(1), name: 'Xbox' });

    expect(findPlatformMatch([xbox], ['Xbox 360'])).toBeNull();
  });

  it('returns null when no input is known', () => {
    const ps5 = candidate({ id: testId(1), name: 'PlayStation 5' });

    expect(findPlatformMatch([ps5], ['Atari Jaguar', 'Dreamcast'])).toBeNull();
  });

  it('never matches a key shared by two distinct platforms', () => {
    const a = candidate({ id: testId(1), name: 'Shared' });
    const b = candidate({
      id: testId(2),
      name: 'Other',
      abbreviation: 'Shared',
    });

    expect(findPlatformMatch([a, b], ['Shared'])).toBeNull();
  });

  it('matches through an alias', () => {
    const ps5 = candidate({
      id: testId(1),
      name: 'PlayStation 5',
      aliases: ['PlayStaton 5'],
    });

    expect(findPlatformMatch([ps5], ['PlayStaton 5'])).toBe(ps5);
  });

  it('matches a PC DVD ROM banner to the canonical PC platform', () => {
    const pc = candidate({
      id: testId(3),
      name: 'PC (Microsoft Windows)',
      abbreviation: 'PC',
    });

    expect(findPlatformMatch([pc], expandPlatformInputs('PC DVD ROM'))).toBe(
      pc,
    );
  });

  it('resolves a PC DVD ROM banner to the canonical row, not a legacy Windows row (regression)', () => {
    // The index stays pure and `expandPlatformInputs` puts the canonical "PC"
    // first, so the canonical row wins even though a legacy "Windows" row is
    // present. If the synonym collided on the index instead, the ambiguity
    // guard would return null and the importer would create a junk platform.
    const legacy = candidate({
      id: testId(7),
      name: 'Windows',
      abbreviation: null,
      alternativeName: null,
      aliases: [],
    });
    const canonical = candidate({
      id: testId(3),
      name: 'PC (Microsoft Windows)',
      abbreviation: 'PC',
      alternativeName: null,
      aliases: [],
    });

    expect(
      findPlatformMatch(
        [legacy, canonical],
        expandPlatformInputs('PC DVD ROM'),
      ),
    ).toBe(canonical);
  });

  it('matches a canonical name by exact key through the pure matcher (sync path)', () => {
    // `platforms:sync` calls `findPlatformMatch` directly with the raw IGDB
    // name. A row named "PC (Microsoft Windows)" with no abbreviation must
    // match its own name exactly — no synonym rewrite, no createCanonical.
    const canonical = candidate({
      id: testId(3),
      name: 'PC (Microsoft Windows)',
      abbreviation: null,
    });

    expect(findPlatformMatch([canonical], ['PC (Microsoft Windows)'])).toBe(
      canonical,
    );
  });

  it('does not force-match PC Engine to the PC platform', () => {
    const pc = candidate({
      id: testId(3),
      name: 'PC (Microsoft Windows)',
      abbreviation: 'PC',
    });

    expect(
      findPlatformMatch([pc], expandPlatformInputs('PC Engine')),
    ).toBeNull();
  });

  it('never matches an alias key shared by two distinct platforms', () => {
    const a = candidate({ id: testId(1), name: 'Alpha', aliases: ['Shared'] });
    const b = candidate({ id: testId(2), name: 'Beta', aliases: ['Shared'] });

    expect(findPlatformMatch([a, b], ['Shared'])).toBeNull();
  });

  it('treats a platform without aliases as a valid candidate (regression)', () => {
    const ps5 = candidate({ id: testId(1), name: 'PlayStation 5' });

    expect(findPlatformMatch([ps5], ['PlayStation 5'])).toBe(ps5);
  });

  it('skips null, undefined, and blank inputs', () => {
    const platform = candidate({ id: testId(1), name: 'Alpha' });

    expect(
      findPlatformMatch([platform], [null, undefined, '', '   ', 'Alpha']),
    ).toBe(platform);
  });
});
