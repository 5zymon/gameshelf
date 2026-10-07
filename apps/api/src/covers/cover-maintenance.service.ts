import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CoverCacheService } from './cover-cache.service';

/**
 * Ref-counted deletion of stored cover files. A file is only removed when no
 * other game row still references the same served URL, so replacing a cover or
 * deleting a game can never break a sibling row that shares the cached file
 * (e.g. two imports of the same candidate).
 */
@Injectable()
export class CoverMaintenanceService {
  private readonly logger = new Logger(CoverMaintenanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CoverCacheService,
  ) {}

  /** Deletes the stored cover (and thumb) when no other game references it. */
  async removeIfUnreferenced(
    servedUrl: string | null,
    exceptGameId?: number,
  ): Promise<void> {
    if (servedUrl === null) {
      return;
    }
    try {
      const count = await this.prisma.game.count({
        where: {
          coverUrl: servedUrl,
          ...(exceptGameId !== undefined && { id: { not: exceptGameId } }),
        },
      });
      if (count === 0) {
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
