import type { Prisma } from '../generated/prisma/client';
import { coverThumbUrlFor } from '../covers/covers.options';
import { parseEditedFields } from '../enrichment/reenrichment';
import { GameDetailModel, GameListItemModel } from './dto/game-response.model';

/** Platform projection used in every game response (D4). */
export const PLATFORM_SELECT = {
  id: true,
  name: true,
  slug: true,
} satisfies Prisma.PlatformSelect;

/** The list projection (`GET /games` items). */
export const GAME_LIST_SELECT = {
  id: true,
  title: true,
  edition: true,
  coverUrl: true,
  platform: { select: PLATFORM_SELECT },
} satisfies Prisma.GameSelect;

/** The game detail projection: platform + ordered gallery. */
export const GAME_DETAIL_INCLUDE = {
  platform: { select: PLATFORM_SELECT },
  images: { select: { url: true }, orderBy: { position: 'asc' } },
} satisfies Prisma.GameInclude;

export type GameDetailRow = Prisma.GameGetPayload<{
  include: typeof GAME_DETAIL_INCLUDE;
}>;

/** A `Game` row with the lighter list projection. */
export type GameListRow = Prisma.GameGetPayload<{
  select: typeof GAME_LIST_SELECT;
}>;

const IGDB_GAME_URL = 'https://www.igdb.com/games/';

/**
 * Canonical IGDB page for a game, or `null` unless the game came from IGDB,
 * carries its external id, and has a stored slug (games enriched before the
 * slug was stored get no link until re-enriched).
 */
export function igdbUrlFor(game: {
  source: string;
  externalId: number | null;
  igdbSlug: string | null;
}): string | null {
  if (game.source !== 'IGDB' || game.externalId === null || !game.igdbSlug) {
    return null;
  }
  return `${IGDB_GAME_URL}${encodeURIComponent(game.igdbSlug)}`;
}

/**
 * Maps a persisted `Game` row onto the full response model, decoding the JSON
 * provenance column into an array, deriving the same-origin thumbnail URL, and
 * exposing the ordered gallery as same-origin `url` + `thumbUrl` pairs. The
 * internal `sourceCoverUrl` and `igdbSlug` are stripped so an external host can
 * never reach a response body; the IGDB page is exposed only as `igdbUrl`.
 */
export function toGameDetail(game: GameDetailRow): GameDetailModel {
  const { sourceCoverUrl: _sourceCoverUrl, igdbSlug, images, ...rest } = game;
  return {
    ...rest,
    igdbUrl: igdbUrlFor({ ...rest, igdbSlug }),
    coverThumbUrl: coverThumbUrlFor(rest.coverUrl),
    userEditedFields: parseEditedFields(rest.userEditedFields),
    images: images.map((image) => ({
      url: image.url,
      thumbUrl: coverThumbUrlFor(image.url),
    })),
  };
}

/** Maps a list row onto the list response model with its thumbnail URL. */
export function toGameListItem(item: GameListRow): GameListItemModel {
  return {
    ...item,
    coverThumbUrl: coverThumbUrlFor(item.coverUrl),
  };
}
