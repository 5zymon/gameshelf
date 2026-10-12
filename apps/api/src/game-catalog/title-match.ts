/** A candidate is accepted at or above this similarity. */
export const CONFIDENT_MATCH_MIN_SCORE = 0.8;

/**
 * Score for a franchise-prefix match: the query is the candidate's tail behind
 * a `:` / ` - ` separator (`Dawn of War III` in
 * `Warhammer 40,000: Dawn of War III`). Above `CONFIDENT_MATCH_MIN_SCORE`,
 * below an exact equality, so an exact name still ranks first.
 */
export const SUFFIX_MATCH_SCORE = 0.95;

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

/**
 * Minimum query tokens for the suffix rule. Two tokens keep a single generic
 * word (`War`) from latching onto the tail of an unrelated title
 * (`Warhammer 40,000: Dawn of War`).
 */
const SUFFIX_MATCH_MIN_TOKENS = 2;

/** A franchise/subtitle separator in a raw name: `: `, ` - `, ` – `, ` — `. */
const TITLE_SEPARATOR = /:\s|\s[-–—]\s/g;

/**
 * True when the raw candidate name is `<prefix><separator><query>`, i.e. the
 * query is the part after a franchise separator (`Warhammer 40,000: Dawn of
 * War III`). The separator is required, and is checked on the raw name because
 * normalization strips punctuation: without it `Super Mario Bros` would match
 * `New Super Mario Bros`, a different game that merely ends the same way.
 */
function isFranchisePrefixed(query: string, rawCandidate: string): boolean {
  if (query.split(' ').length < SUFFIX_MATCH_MIN_TOKENS) return false;
  for (const separator of rawCandidate.matchAll(TITLE_SEPARATOR)) {
    const tail = rawCandidate.slice(separator.index + separator[0].length);
    if (normalizeTitle(tail) === query) return true;
  }
  return false;
}

/** Similarity in [0,1]; 1 = normalized equality, 0 = blank or version-divergent. */
export function titleSimilarity(query: string, candidate: string): number {
  return similarity(normalizeTitle(query), candidate);
}

/** Similarity of a normalized query against a raw candidate name. */
function similarity(a: string, rawCandidate: string): number {
  const b = normalizeTitle(rawCandidate);
  if (a === '' || b === '') return 0;
  if (a === b) return 1;
  if (differsOnlyByVersionToken(a, b)) return 0;
  if (isFranchisePrefixed(a, rawCandidate)) return SUFFIX_MATCH_SCORE;
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
      score: similarity(normalizedQuery, game.name),
    }))
    .sort((x, y) => y.score - x.score);
}

/**
 * Best candidate, or null when even the top score is below the threshold, or
 * when several candidates tie on the franchise-prefix score (ambiguous: picking
 * one by IGDB order could import the wrong game).
 */
export function selectConfidentMatch<T extends { name: string }>(
  query: string,
  candidates: readonly T[],
): TitleMatch<T> | null {
  const [best, runnerUp] = rankTitleMatches(query, candidates);
  if (best === undefined || best.score < CONFIDENT_MATCH_MIN_SCORE) {
    return null;
  }
  if (
    best.score === SUFFIX_MATCH_SCORE &&
    runnerUp?.score === SUFFIX_MATCH_SCORE
  ) {
    return null;
  }
  return best;
}
