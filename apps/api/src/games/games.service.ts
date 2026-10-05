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
    const where = this.buildWhere(query);
    const orderBy = this.buildOrderBy(query);
    const [items, total, platforms, editions] = await Promise.all([
      this.prisma.game.findMany({
        select: {
          id: true,
          title: true,
          edition: true,
          coverUrl: true,
          platform: { select: PLATFORM_SELECT },
        },
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.game.count({ where }),
      this.prisma.platform.findMany({
        where: { games: { some: {} } },
        select: { id: true, name: true, slug: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.game.findMany({
        distinct: ['edition'],
        where: { edition: { not: null } },
        select: { edition: true },
        orderBy: { edition: 'asc' },
      }),
    ]);
    return {
      items,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
      filters: {
        platforms,
        editions: editions.flatMap((e) =>
          e.edition === null ? [] : [e.edition],
        ),
      },
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

  private buildWhere(query: ListGamesQueryDto): Prisma.GameWhereInput {
    const where: Prisma.GameWhereInput = {};
    if (query.platformId !== undefined) {
      where.platformId = query.platformId;
    }
    const edition = this.trimToUndefined(query.edition);
    if (edition !== undefined) {
      where.edition = edition;
    }
    if (query.year !== undefined) {
      where.releaseYear = query.year;
    }
    const publisher = this.trimToUndefined(query.publisher);
    if (publisher !== undefined) {
      where.publisher = publisher;
    }
    const genre = this.trimToUndefined(query.genre);
    if (genre !== undefined) {
      where.genre = genre;
    }
    if (query.playerCount !== undefined) {
      where.playerCount = query.playerCount;
    }
    const q = this.trimToUndefined(query.q);
    if (q !== undefined) {
      where.title = { contains: this.escapeLike(q) };
    }
    return where;
  }

  private buildOrderBy(
    query: ListGamesQueryDto,
  ): Prisma.GameOrderByWithRelationInput[] {
    const order: Prisma.SortOrder = query.order ?? 'asc';
    // Every case returns an array so the `id` tiebreaker is always the last
    // element.
    switch (query.sort) {
      case 'title':
        return [{ title: order }, { id: 'asc' }];
      case 'year':
        return [{ releaseYear: { sort: order, nulls: 'last' } }, { id: 'asc' }];
      case 'platform':
        return [{ platform: { name: order } }, { id: 'asc' }];
      case 'createdAt':
        return [{ createdAt: order }, { id: 'asc' }];
      default:
        return [{ id: 'asc' }];
    }
  }

  private trimToUndefined(value: string | undefined): string | undefined {
    if (value === undefined) {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  }

  private escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
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
