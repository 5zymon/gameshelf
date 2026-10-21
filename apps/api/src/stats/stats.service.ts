import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StatsResponseModel } from './dto/stats-response.model';

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats(): Promise<StatsResponseModel> {
    const yearCounts = this.prisma.game.groupBy({
      by: ['releaseYear'],
      orderBy: { releaseYear: 'asc' },
      _count: { _all: true },
    });
    const [aggregate, platforms, unverifiedPlatform, years] =
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
        yearCounts,
      ]);
    const byDecade = new Map<number, number>();
    let noReleaseYear = 0;
    for (const row of years) {
      if (row.releaseYear === null) {
        noReleaseYear += row._count._all;
        continue;
      }
      const decade = Math.floor(row.releaseYear / 10) * 10;
      byDecade.set(decade, (byDecade.get(decade) ?? 0) + row._count._all);
    }
    return {
      totals: {
        games: aggregate._count._all,
        copies: aggregate._sum.copyCount ?? 0,
      },
      platforms: platforms
        .map((p) => ({ id: p.id, name: p.name, games: p._count.games }))
        .sort((a, b) => b.games - a.games || a.name.localeCompare(b.name)),
      dataQuality: { unverifiedPlatform },
      decades: [...byDecade]
        .map(([decade, games]) => ({ decade, games }))
        .sort((a, b) => a.decade - b.decade),
      noReleaseYear,
    };
  }
}
