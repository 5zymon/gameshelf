import { normalizeTitle } from '../game-catalog/title-match';

/** Identity inputs for one game (incoming data or an existing row). */
export interface GameIdentity {
  title: string;
  platformId: number;
  edition: string | null;
  source: string; // GameSource / CatalogSource
  externalId: number | null;
}

/** HTTP/machine-readable code returned on the duplicate 409. */
export const GAME_ALREADY_IN_CATALOG = 'GAME_ALREADY_IN_CATALOG';

/** Normalizes an edition for identity comparison; blank/whitespace → null. */
export function normalizeEdition(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  const normalized = normalizeTitle(value);
  return normalized === '' ? null : normalized;
}

function isLinked(game: GameIdentity): boolean {
  return game.externalId !== null && game.source !== 'MANUAL';
}

/**
 * The single identity rule shared by manual add and the import commit:
 * - platformId and normalized edition must always match;
 * - two linked games match on their external record (source + externalId);
 * - otherwise (either side unlinked) match on normalized title.
 * Symmetric, so a linked import matches an existing unlinked manual row and
 * vice versa (overlapping photos / re-uploaded shelves never fork a row).
 */
export function isSameGameIdentity(a: GameIdentity, b: GameIdentity): boolean {
  if (a.platformId !== b.platformId) return false;
  if (normalizeEdition(a.edition) !== normalizeEdition(b.edition)) return false;
  if (isLinked(a) && isLinked(b)) {
    return a.source === b.source && a.externalId === b.externalId;
  }
  return normalizeTitle(a.title) === normalizeTitle(b.title);
}
