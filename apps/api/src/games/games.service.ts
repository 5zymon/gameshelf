import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGameDto } from './dto/create-game.dto';
import {
  GameDetailModel,
  ListGamesResponseModel,
} from './dto/game-response.model';
import { ListGamesQueryDto } from './dto/list-games-query.dto';
import { UpdateGameDto } from './dto/update-game.dto';

const PLATFORM_SELECT: Prisma.PlatformSelect = {
  id: true,
  name: true,
  slug: true,
};

@Injectable()
export class GamesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListGamesQueryDto): Promise<ListGamesResponseModel> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const [items, total] = await Promise.all([
      this.prisma.game.findMany({
        select: {
          id: true,
          title: true,
          edition: true,
          coverUrl: true,
          platform: { select: PLATFORM_SELECT },
        },
        orderBy: { id: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.game.count(),
    ]);
    return {
      items,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: number): Promise<GameDetailModel> {
    const game = await this.prisma.game.findUnique({
      where: { id },
      include: { platform: { select: PLATFORM_SELECT } },
    });
    if (!game) {
      throw new NotFoundException(`Game with id ${String(id)} not found`);
    }
    return game;
  }

  async create(dto: CreateGameDto): Promise<GameDetailModel> {
    await this.assertPlatformExists(dto.platformId);
    return this.prisma.game.create({
      data: {
        title: dto.title,
        platformId: dto.platformId,
        edition: dto.edition ?? null,
        releaseYear: dto.releaseYear ?? null,
        publisher: dto.publisher ?? null,
        genre: dto.genre ?? null,
        playerCount: dto.playerCount ?? null,
        coverUrl: dto.coverUrl ?? null,
      },
      include: { platform: { select: PLATFORM_SELECT } },
    });
  }

  async update(id: number, dto: UpdateGameDto): Promise<GameDetailModel> {
    // `PartialType` adds `@IsOptional`, which lets an explicit `null` past
    // validation. So `title`/`platformId` can be `null` at runtime even though
    // the static type (inherited from `CreateGameDto`) says otherwise. Both are
    // non-nullable columns, so reject an explicit `null` before it reaches Prisma.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (dto.title === null) {
      throw new BadRequestException('title must not be null');
    }
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (dto.platformId === null) {
      throw new BadRequestException('platformId must not be null');
    }
    const existing = await this.prisma.game.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException(`Game with id ${String(id)} not found`);
    }
    if (dto.platformId !== undefined) {
      await this.assertPlatformExists(dto.platformId);
    }
    return this.prisma.game.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.platformId !== undefined && { platformId: dto.platformId }),
        ...(dto.edition !== undefined && { edition: dto.edition }),
        ...(dto.releaseYear !== undefined && { releaseYear: dto.releaseYear }),
        ...(dto.publisher !== undefined && { publisher: dto.publisher }),
        ...(dto.genre !== undefined && { genre: dto.genre }),
        ...(dto.playerCount !== undefined && { playerCount: dto.playerCount }),
        ...(dto.coverUrl !== undefined && { coverUrl: dto.coverUrl }),
      },
      include: { platform: { select: PLATFORM_SELECT } },
    });
  }

  async remove(id: number): Promise<void> {
    const existing = await this.prisma.game.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException(`Game with id ${String(id)} not found`);
    }
    await this.prisma.game.delete({ where: { id } });
  }

  private async assertPlatformExists(platformId: number): Promise<void> {
    const platform = await this.prisma.platform.findUnique({
      where: { id: platformId },
      select: { id: true },
    });
    if (!platform) {
      throw new BadRequestException(
        `Platform with id ${String(platformId)} does not exist`,
      );
    }
  }
}
