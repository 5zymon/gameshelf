import type { PrismaService } from '../prisma/prisma.service';

export interface DevDataCounts {
  games: number;
  gameImages: number;
  gameVideos: number;
  importJobs: number;
  recognizedItems: number;
  unrecognizedItems: number;
  platforms: number;
}

/**
 * Row counts for the tables `clearDevData` deletes. Used to show the operator
 * what is about to go, and to summarise what went.
 */
export async function countDevData(
  prisma: PrismaService,
): Promise<DevDataCounts> {
  const [
    games,
    gameImages,
    gameVideos,
    importJobs,
    recognizedItems,
    unrecognizedItems,
    platforms,
  ] = await Promise.all([
    prisma.game.count(),
    prisma.gameImage.count(),
    prisma.gameVideo.count(),
    prisma.importJob.count(),
    prisma.recognizedItem.count(),
    prisma.unrecognizedItem.count(),
    prisma.platform.count(),
  ]);
  return {
    games,
    gameImages,
    gameVideos,
    importJobs,
    recognizedItems,
    unrecognizedItems,
    platforms,
  };
}

/**
 * Deletes all game data and import data in one transaction.
 *
 * Deleted: recognized/unrecognized items, import jobs, game videos/images, all
 * games, and all platforms (their aliases go via the DB-level
 * `onDelete: Cascade`). Games go before platforms because `Game.platform` has
 * no cascade.
 *
 * Kept: `users` and `sessions` (the operator stays logged in), `llm_settings`
 * (the encrypted provider key/config; wiping it blocks photo imports), and the
 * `import_queue_state` row (the durable pause, ADR-005; clearing jobs must not
 * silently resume a queue paused for a config error). Platforms are not kept:
 * `npm run platforms:sync` and `npm run db:seed` rebuild them.
 *
 * Children are deleted first, following `test/helpers/reset.ts`.
 */
export async function clearDevData(
  prisma: PrismaService,
): Promise<DevDataCounts> {
  const [
    recognizedItems,
    unrecognizedItems,
    importJobs,
    gameVideos,
    gameImages,
    games,
    platforms,
  ] = await prisma.$transaction([
    prisma.recognizedItem.deleteMany(),
    prisma.unrecognizedItem.deleteMany(),
    prisma.importJob.deleteMany(),
    prisma.gameVideo.deleteMany(),
    prisma.gameImage.deleteMany(),
    prisma.game.deleteMany(),
    prisma.platform.deleteMany(),
  ]);
  return {
    games: games.count,
    gameImages: gameImages.count,
    gameVideos: gameVideos.count,
    importJobs: importJobs.count,
    recognizedItems: recognizedItems.count,
    unrecognizedItems: unrecognizedItems.count,
    platforms: platforms.count,
  };
}
