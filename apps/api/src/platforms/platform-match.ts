/**
 * Anchored platform-name matching (ticket 4.2).
 *
 * A platform may be referenced by its canonical name, its abbreviation
 * ("PS5"), or an alternative name. Matching is equality-only after
 * normalization — there is deliberately no fuzzy or containment matching, so
 * a near-miss ("PlayStation 4" vs "PlayStation 5") never force-matches.
 */

/** The fields the matcher needs from a platform row. */
export interface PlatformMatchCandidate {
  id: string;
  name: string;
  abbreviation: string | null;
  alternativeName: string | null;
  /** Extra match keys: the old name after a rename, merged-away names. */
  aliases?: readonly string[];
}

/**
 * Case-, diacritic-, punctuation-, and whitespace-insensitive normalization
 * that preserves word order and boundaries (anchored). `&` is expanded to
 * "and" so "Rock & Roll" and "Rock and Roll" are equal.
 */
export function normalizePlatformName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Media-banner notations that mean the same hardware as IGDB's canonical name,
 * mapped to the canonical string(s) to prefer when matching. Equality-only:
 * a value is rewritten only when its normalized key is an exact key of this
 * table, so a near-miss ("PC Engine") is never force-matched.
 */
const PLATFORM_INPUT_SYNONYMS = new Map<string, readonly string[]>([
  ['pc dvd rom', ['PC', 'PC (Microsoft Windows)']],
  ['pc dvdrom', ['PC', 'PC (Microsoft Windows)']],
  ['pc dvd', ['PC', 'PC (Microsoft Windows)']],
  ['pc cd rom', ['PC', 'PC (Microsoft Windows)']],
  ['pc cdrom', ['PC', 'PC (Microsoft Windows)']],
  ['pc rom', ['PC', 'PC (Microsoft Windows)']],
  ['microsoft windows', ['PC', 'PC (Microsoft Windows)']],
  ['pc windows', ['PC', 'PC (Microsoft Windows)']],
  ['windows pc', ['PC', 'PC (Microsoft Windows)']],
  ['windows', ['PC', 'PC (Microsoft Windows)']],
]);

/**
 * Expands a platform string read off a photo into the ordered list of strings
 * to match against the local Platform table: the canonical equivalent(s) first
 * (so the canonical row wins), then the literal input. Inputs with no known
 * synonym yield just the input. The matcher index stays pure, so this synonym
 * set can never rewrite or collide the table (and `platforms:sync`, which does
 * not use this helper, keeps matching canonical names exactly).
 */
export function expandPlatformInputs(value: string): string[] {
  const canonical = PLATFORM_INPUT_SYNONYMS.get(normalizePlatformName(value));
  if (canonical === undefined) {
    return [value];
  }
  return [...canonical, value];
}

/**
 * Returns the single platform whose name/abbreviation/alternative name
 * normalizes to one of the inputs, or `null`.
 *
 * The matcher is pure and equality-only: both index and input keys are the
 * plain `normalizePlatformName`. Explicit synonyms (e.g. "PC DVD ROM" → the
 * canonical PC) are handled by `expandPlatformInputs`, never here. The first
 * input with a known key wins (so input order is respected). A key shared by
 * two distinct platform ids is treated as ambiguous and never matched, and
 * blank normalized keys are skipped.
 */
export function findPlatformMatch<T extends PlatformMatchCandidate>(
  platforms: readonly T[],
  inputs: readonly (string | null | undefined)[],
): T | null {
  const index = new Map<string, T | null>();
  for (const platform of platforms) {
    for (const raw of [
      platform.name,
      platform.abbreviation,
      platform.alternativeName,
      ...(platform.aliases ?? []),
    ]) {
      if (raw === null) {
        continue;
      }
      const key = normalizePlatformName(raw);
      if (key === '') {
        continue;
      }
      const existing = index.get(key);
      if (existing === undefined) {
        index.set(key, platform);
      } else if (existing?.id !== platform.id) {
        // Two distinct platforms share this key — never guess between them.
        index.set(key, null);
      }
    }
  }

  for (const input of inputs) {
    if (input === null || input === undefined) {
      continue;
    }
    const key = normalizePlatformName(input);
    if (key === '') {
      continue;
    }
    const match = index.get(key);
    if (match !== undefined && match !== null) {
      return match;
    }
  }
  return null;
}
