import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StatsResponseModel } from './dto/stats-response.model';

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats(): Promise<StatsResponseModel> {
    const [aggregate, platforms, unverifiedPlatform] =
      await this.prisma.$transaction([
        this.prisma.game.aggregate({
          _count: { _all: true },
          _sum: { copyCount: true },
        }),
        this.prisma.platform.findMany({
          where: { games: { some: {} } },
          select: {
            id: true,
            name: true,
            _count: { select: { games: true } },
          },
        }),
        this.prisma.game.count({ where: { platformUnverified: true } }),
      ]);
    return {
      totals: {
        games: aggregate._count._all,
        copies: aggregate._sum.copyCount ?? 0,
      },
      platforms: platforms
        .map((p) => ({ id: p.id, name: p.name, games: p._count.games }))
        .sort((a, b) => b.games - a.games || a.name.localeCompare(b.name)),
      dataQuality: { unverifiedPlatform },
    };
  }
}
