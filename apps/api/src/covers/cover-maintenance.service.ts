import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CoverCacheService } from './cover-cache.service';

/**
 * Ref-counted deletion of stored cover files. A file is only removed when no
 * other game row still references the same served URL — as a cover or as a
 * gallery image — so replacing a cover or deleting a game can never break a
 * sibling row that shares the cached file (e.g. two imports of the same
 * candidate).
 */
@Injectable()
export class CoverMaintenanceService {
  private readonly logger = new Logger(CoverMaintenanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CoverCacheService,
  ) {}

  /**
   * Deletes the stored cover (and thumb) when no other game references it.
   *
   * The exclusion is scoped per relation: `exceptCoverGameId` skips one game
   * only from the `Game.coverUrl` count and `exceptImageGameId` skips one game
   * only from the `GameImage.url` count. A caller replacing a cover must not
   * exclude that game from the gallery count (its unchanged gallery may still
   * point at the old file), and a caller replacing the gallery must not exclude
   * it from the cover count (the removed file may still be the current cover).
   */
  async removeIfUnreferenced(
    servedUrl: string | null,
    except?: {
      exceptCoverGameId?: string;
      exceptImageGameId?: string;
    },
  ): Promise<void> {
    if (servedUrl === null) {
      return;
    }
    const exceptCoverGameId = except?.exceptCoverGameId;
    const exceptImageGameId = except?.exceptImageGameId;
    try {
      const [coverCount, imageCount] = await Promise.all([
        this.prisma.game.count({
          where: {
            coverUrl: servedUrl,
            ...(exceptCoverGameId !== undefined && {
              id: { not: exceptCoverGameId },
            }),
          },
        }),
        this.prisma.gameImage.count({
          where: {
            url: servedUrl,
            ...(exceptImageGameId !== undefined && {
              gameId: { not: exceptImageGameId },
            }),
          },
        }),
      ]);
      if (coverCount === 0 && imageCount === 0) {
        await this.cache.removeByServedUrl(servedUrl);
      }
    } catch (error) {
      this.logger.warn(
        `Failed to remove cover "${servedUrl}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
