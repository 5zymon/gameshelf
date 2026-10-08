import { isApiError, type Platform } from '@/lib/api';

/**
 * The three platform shapes the row itself encodes (mirrors the Platforms API
 * table in docs/features/platforms-api.md — there is no `kind` column).
 */
export type PlatformKind = 'import' | 'canonical' | 'manual';

/**
 * `addedByImport` wins: an import row is "awaiting review" even after a sync
 * links it (`updateCanonical` sets `igdbId`, `addedByImport` stays true until
 * confirm).
 */
export function platformKind(
  p: Pick<Platform, 'addedByImport' | 'igdbId'>,
): PlatformKind {
  if (p.addedByImport) return 'import';
  if (p.igdbId !== null) return 'canonical';
  return 'manual';
}

export const PLATFORM_KIND_LABEL: Record<PlatformKind, string> = {
  import: 'Added by import',
  canonical: 'Reference',
  manual: 'Manual',
};

const PLATFORM_KIND_HINT: Record<PlatformKind, string> = {
  import:
    'Created by an import for a name it did not recognize. Keep it as is, or merge it into an existing platform.',
  canonical:
    'Part of the reference list synced from the game database. Matching targets, not user data.',
  manual: 'A platform you added by hand.',
};

export function platformKindHint(kind: PlatformKind): string {
  return PLATFORM_KIND_HINT[kind];
}

/**
 * 4c + 4b: the default list shows platforms with games, plus unreviewed
 * imports (which stay visible until confirmed or merged). A hidden platform is
 * excluded even when it has games — `showAll` is the only path that reveals
 * it.
 */
export function inDefaultView(
  p: Pick<Platform, 'gameCount' | 'addedByImport' | 'hidden'>,
): boolean {
  return (p.gameCount > 0 && !p.hidden) || p.addedByImport;
}

export function filterPlatforms(
  platforms: readonly Platform[],
  showAll: boolean,
): Platform[] {
  return showAll ? [...platforms] : platforms.filter(inDefaultView);
}

export function splitImported(platforms: readonly Platform[]): {
  imported: Platform[];
  rest: Platform[];
} {
  const imported: Platform[] = [];
  const rest: Platform[] = [];
  for (const platform of platforms) {
    if (platform.addedByImport) {
      imported.push(platform);
    } else {
      rest.push(platform);
    }
  }
  return { imported, rest };
}

export function gameCountLabel(count: number): string {
  return `${String(count)} ${count === 1 ? 'game' : 'games'}`;
}

export function mergeConfirmation(
  sourceName: string,
  targetName: string,
  gameCount: number,
): string {
  return `Move ${gameCountLabel(gameCount)} from “${sourceName}” to “${targetName}”? “${sourceName}” is kept as an alias so future imports still match it; the platform is then removed.`;
}

export function deleteBlockedHint(): string {
  return 'Reassign its games first — merge it into another platform, or edit each game.';
}

/**
 * Message for a failed platform mutation: the API's user-facing message for a
 * real HTTP error, or `fallback` for a network failure (`status === 0`).
 * Callers branch on `401` (sign out) and `404` (already gone) first.
 */
export function platformErrorMessage(
  caught: unknown,
  fallback: string,
): string {
  return isApiError(caught) && caught.status !== 0
    ? caught.userMessage
    : fallback;
}
