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

/** A `Game` row with the shared platform projection. */
export type GameWithPlatform = Prisma.GameGetPayload<{
  include: { platform: { select: typeof PLATFORM_SELECT } };
}>;

/** A `Game` row with the lighter list projection. */
export type GameListRow = Prisma.GameGetPayload<{
  select: typeof GAME_LIST_SELECT;
}>;

/**
 * Maps a persisted `Game` row onto the full response model, decoding the JSON
 * provenance column into an array and deriving the same-origin thumbnail URL.
 * The internal `sourceCoverUrl` is stripped so an external host can never reach
 * a response body.
 */
export function toGameDetail(game: GameWithPlatform): GameDetailModel {
  const { sourceCoverUrl: _sourceCoverUrl, ...rest } = game;
  return {
    ...rest,
    coverThumbUrl: coverThumbUrlFor(rest.coverUrl),
    userEditedFields: parseEditedFields(rest.userEditedFields),
  };
}

/** Maps a list row onto the list response model with its thumbnail URL. */
export function toGameListItem(item: GameListRow): GameListItemModel {
  return {
    ...item,
    coverThumbUrl: coverThumbUrlFor(item.coverUrl),
  };
}
