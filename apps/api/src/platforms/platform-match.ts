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
  id: number;
  name: string;
  abbreviation: string | null;
  alternativeName: string | null;
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
 * Returns the single platform whose name/abbreviation/alternative name
 * normalizes to one of the inputs, or `null`.
 *
 * The first input with a known key wins (so candidate order is respected). A
 * key shared by two distinct platform ids is treated as ambiguous and never
 * matched, and blank normalized keys are skipped.
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
