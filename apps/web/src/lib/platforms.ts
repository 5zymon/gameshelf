import type { TranslatorFor } from '@/i18n/translate';
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

/** Kind chip label from the `platforms` namespace (`kind.*`). */
export function platformKindLabel(
  kind: PlatformKind,
  t: TranslatorFor<'platforms'>,
): string {
  return t(`kind.${kind}`);
}

/** Kind chip tooltip from the `platforms` namespace (`kindHint.*`). */
export function platformKindHint(
  kind: PlatformKind,
  t: TranslatorFor<'platforms'>,
): string {
  return t(`kindHint.${kind}`);
}

/**
 * 4c + 4b: the default list shows platforms with games, plus unreviewed
 * imports (which stay visible until confirmed or merged), plus every
 * custom/user-created platform (`igdbId === null`) so a freshly added row is
 * visible immediately even with zero games. A hidden platform is excluded even
 * when it has games — `showAll` is the only path that reveals it. Reference
 * platforms (`igdbId !== null`) still need at least one game to appear.
 */
export function inDefaultView(
  p: Pick<Platform, 'gameCount' | 'addedByImport' | 'hidden' | 'igdbId'>,
): boolean {
  return (
    p.addedByImport || (!p.hidden && (p.gameCount > 0 || p.igdbId === null))
  );
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

export function gameCountLabel(
  count: number,
  t: TranslatorFor<'platforms'>,
): string {
  return t('gameCount', { count });
}

export function mergeConfirmation(
  sourceName: string,
  targetName: string,
  gameCount: number,
  t: TranslatorFor<'platforms'>,
): string {
  return t('merge.confirm', {
    source: sourceName,
    target: targetName,
    count: gameCount,
  });
}

export function deleteBlockedHint(t: TranslatorFor<'platforms'>): string {
  return t('confirmDelete.hint');
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
