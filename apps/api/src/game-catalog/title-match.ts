/** A candidate is accepted at or above this similarity. */
export const CONFIDENT_MATCH_MIN_SCORE = 0.8;

/** Lowercases, strips diacritics/punctuation, and collapses whitespace. */
export function normalizeTitle(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export interface TitleMatch<T> {
  game: T;
  score: number;
}

/** Levenshtein distance, iterative two-row DP. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous: number[] = Array.from(
    { length: b.length + 1 },
    (_, index) => index,
  );
  let current: number[] = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    [previous, current] = [current, previous];
  }
  return previous[b.length] ?? 0;
}

/** Roman numerals and bare numbers used as installment/version markers. */
const VERSION_TOKEN = /^(?:i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii|\d+)$/;

/**
 * True when `a` and `b` differ *only* by an installment/version token
 * (`2`, `II`, `V`), i.e. FIFA 24 vs FIFA 23 or Halo vs Halo 2. Such pairs must
 * never be treated as typos, so they score 0 unless exactly equal.
 */
function differsOnlyByVersionToken(a: string, b: string): boolean {
  const strip = (value: string): string =>
    value
      .split(' ')
      .filter((token) => !VERSION_TOKEN.test(token))
      .join(' ');
  const tokens = (value: string): string[] =>
    value.split(' ').filter((token) => VERSION_TOKEN.test(token));
  const tokensA = tokens(a);
  const tokensB = tokens(b);
  if (tokensA.join('|') === tokensB.join('|')) return false;
  return strip(a) === strip(b);
}

/** Similarity in [0,1]; 1 = normalized equality, 0 = blank or version-divergent. */
export function titleSimilarity(query: string, candidate: string): number {
  return similarity(normalizeTitle(query), normalizeTitle(candidate));
}

/** Similarity over already-normalized strings (see `titleSimilarity`). */
function similarity(a: string, b: string): number {
  if (a === '' || b === '') return 0;
  if (a === b) return 1;
  if (differsOnlyByVersionToken(a, b)) return 0;
  const maxLen = Math.max(a.length, b.length);
  const edit = 1 - levenshtein(a, b) / maxLen;
  if (a.includes(b) || b.includes(a)) {
    return Math.max(edit, Math.min(a.length, b.length) / maxLen);
  }
  return edit;
}

/** Candidates ranked by descending similarity; equal scores keep IGDB order (stable). */
export function rankTitleMatches<T extends { name: string }>(
  query: string,
  candidates: readonly T[],
): TitleMatch<T>[] {
  const normalizedQuery = normalizeTitle(query);
  return candidates
    .map((game) => ({
      game,
      score: similarity(normalizedQuery, normalizeTitle(game.name)),
    }))
    .sort((x, y) => y.score - x.score);
}

/** Best candidate, or null when even the top score is below the threshold. */
export function selectConfidentMatch<T extends { name: string }>(
  query: string,
  candidates: readonly T[],
): TitleMatch<T> | null {
  const best = rankTitleMatches(query, candidates)[0];
  return best !== undefined && best.score >= CONFIDENT_MATCH_MIN_SCORE
    ? best
    : null;
}
