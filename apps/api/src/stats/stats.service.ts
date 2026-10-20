import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StatsResponseModel } from './dto/stats-response.model';

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats(): Promise<StatsResponseModel> {
    const aggregate = await this.prisma.game.aggregate({
      _count: { _all: true },
      _sum: { copyCount: true },
    });
    return {
      totals: {
        games: aggregate._count._all,
        copies: aggregate._sum.copyCount ?? 0,
      },
    };
  }
}
