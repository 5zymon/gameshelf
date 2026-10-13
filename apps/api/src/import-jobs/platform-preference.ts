import type { CatalogCandidate } from '../game-catalog/game-catalog.resolver';
import {
  findPlatformMatch,
  type PlatformMatchCandidate,
} from '../platforms/platform-match';

/** A local platform used to rank re-search candidates (id, names, IGDB id). */
export interface PreferredPlatform extends PlatformMatchCandidate {
  igdbId: number | null;
}

/**
 * True when the candidate lists the platform: an exact IGDB id match first
 * (the canonical link), then the anchored name/abbreviation matcher for
 * sources without IGDB ids (e.g. MobyGames) and for rows whose id is unset.
 */
export function candidateRunsOn(
  candidate: CatalogCandidate,
  platform: PreferredPlatform,
): boolean {
  return (
    (platform.igdbId !== null &&
      candidate.platforms.some((p) => p.igdbId === platform.igdbId)) ||
    findPlatformMatch(
      [platform],
      candidate.platforms.flatMap((p) => [p.name, p.abbreviation]),
    ) !== null
  );
}

/**
 * Stable partition: candidates that run on `platform` come first; the catalog
 * order is kept within each group. A `null` platform returns a copy in catalog
 * order. A boost, never a filter — a game whose IGDB platform tags are
 * incomplete is listed after the matches, not dropped.
 */
export function preferPlatform<T extends CatalogCandidate>(
  candidates: readonly T[],
  platform: PreferredPlatform | null,
): T[] {
  if (platform === null) {
    return [...candidates];
  }
  // One pass: `candidateRunsOn` is evaluated once per candidate.
  const matching: T[] = [];
  const rest: T[] = [];
  for (const candidate of candidates) {
    if (candidateRunsOn(candidate, platform)) {
      matching.push(candidate);
    } else {
      rest.push(candidate);
    }
  }
  return [...matching, ...rest];
}
