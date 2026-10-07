import type { Prisma } from '../generated/prisma/client';
import { parseEditedFields } from '../enrichment/reenrichment';
import { GameDetailModel } from './dto/game-response.model';

/** Platform projection used in every game response (D4). */
export const PLATFORM_SELECT = {
  id: true,
  name: true,
  slug: true,
} satisfies Prisma.PlatformSelect;

/** A `Game` row with the shared platform projection. */
export type GameWithPlatform = Prisma.GameGetPayload<{
  include: { platform: { select: typeof PLATFORM_SELECT } };
}>;

/**
 * Maps a persisted `Game` row onto the full response model, decoding the JSON
 * provenance column into an array. A single seam so every endpoint returns the
 * same shape and `userEditedFields` is always an array, never a raw string.
 */
export function toGameDetail(game: GameWithPlatform): GameDetailModel {
  return {
    ...game,
    userEditedFields: parseEditedFields(game.userEditedFields),
  };
}
