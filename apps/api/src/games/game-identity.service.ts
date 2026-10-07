import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { isSameGameIdentity, type GameIdentity } from './game-identity';

export interface IdentityMatch {
  id: number;
  copyCount: number;
}

@Injectable()
export class GameIdentityService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The one lookup used by both paths. `client` lets the import commit pass its
   * transaction (`tx`) so a row created earlier in the same batch is seen.
   * Narrow by platformId (indexed), then apply the pure rule in JS — edition
   * and title are normalized, so no exact SQL match is possible.
   */
  async findExisting(
    input: GameIdentity,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<IdentityMatch | null> {
    const rows = await client.game.findMany({
      where: { platformId: input.platformId },
      select: {
        id: true,
        title: true,
        platformId: true,
        edition: true,
        source: true,
        externalId: true,
        copyCount: true,
      },
    });
    const match = rows.find((row) => isSameGameIdentity(row, input));
    return match === undefined
      ? null
      : { id: match.id, copyCount: match.copyCount };
  }
}
