import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GameCatalogResolver } from '../game-catalog/game-catalog.resolver';
import { GameEnrichmentService } from '../enrichment/game-enrichment.service';
import {
  buildReenrichmentUpdate,
  mergeEditedFields,
  serializeEditedFields,
  toEditedFields,
  TRACKED_METADATA_FIELDS,
} from '../enrichment/reenrichment';
import { CreateGameDto } from './dto/create-game.dto';
import { EnrichGameDto } from './dto/enrich-game.dto';
import {
  EnrichGameResponseModel,
  toEnrichCandidateModel,
} from './dto/enrich-game-response.model';
import {
  GameDetailModel,
  ListGamesResponseModel,
} from './dto/game-response.model';
import { ListGamesQueryDto } from './dto/list-games-query.dto';
import { UpdateGameDto } from './dto/update-game.dto';
import { PLATFORM_SELECT, toGameDetail } from './game-detail.mapper';

@Injectable()
export class GamesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: GameCatalogResolver,
    private readonly enrichment: GameEnrichmentService,
  ) {}

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
    return toGameDetail(game);
  }

  async create(dto: CreateGameDto): Promise<GameDetailModel> {
    await this.assertPlatformExists(dto.platformId);
    const editedNow = TRACKED_METADATA_FIELDS.filter(
      (field) => dto[field] !== undefined,
    );
    const game = await this.prisma.game.create({
      data: {
        title: dto.title,
        platformId: dto.platformId,
        edition: dto.edition ?? null,
        releaseYear: dto.releaseYear ?? null,
        publisher: dto.publisher ?? null,
        genre: dto.genre ?? null,
        playerCount: dto.playerCount ?? null,
        coverUrl: dto.coverUrl ?? null,
        ...(editedNow.length > 0 && {
          userEditedFields: serializeEditedFields(editedNow),
        }),
      },
      include: { platform: { select: PLATFORM_SELECT } },
    });
    return toGameDetail(game);
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
      select: { id: true, userEditedFields: true },
    });
    if (!existing) {
      throw new NotFoundException(`Game with id ${String(id)} not found`);
    }
    if (dto.platformId !== undefined) {
      await this.assertPlatformExists(dto.platformId);
    }
    // A hand edit to any tracked metadata field is recorded as provenance so a
    // later re-enrichment never overwrites it.
    const editedNow = TRACKED_METADATA_FIELDS.filter(
      (field) => dto[field] !== undefined,
    );
    const game = await this.prisma.game.update({
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
        // Fixing the platform confirms it, so clear any "unverified" flag.
        ...(dto.platformId !== undefined && { platformUnverified: false }),
        ...(editedNow.length > 0 && {
          userEditedFields: serializeEditedFields(
            mergeEditedFields(existing.userEditedFields, editedNow),
          ),
        }),
      },
      include: { platform: { select: PLATFORM_SELECT } },
    });
    return toGameDetail(game);
  }

  /**
   * Re-enrich an existing game against its **current** (possibly corrected)
   * title: re-run the IGDB → MobyGames → unresolved chain and either return the
   * candidate(s) (no body) or apply the picked one (a `candidate` body).
   *
   * Applying updates the existing row in place — never a duplicate — through
   * the same candidate mapping as the import path, then merges it without
   * touching `title`/`platformId`/`edition` or any hand-edited field. A second
   * identical apply writes nothing (record idempotency).
   */
  async enrich(
    id: number,
    dto: EnrichGameDto,
  ): Promise<EnrichGameResponseModel> {
    const game = await this.findOne(id);

    const resolution = await this.catalog.resolve({
      title: game.title,
      edition: game.edition,
      platform: game.platform.name,
      confidence: 1,
    });

    if (resolution.kind === 'transient' || resolution.kind === 'config_error') {
      throw new ServiceUnavailableException(resolution.reason);
    }
    if (resolution.kind === 'unrecognized') {
      return {
        status: 'unrecognized',
        reason: resolution.reason,
        applied: false,
        candidates: [],
        game,
      };
    }

    const candidate = resolution.candidate;
    const candidateModel = toEnrichCandidateModel(candidate);

    // Search step: report the candidate, mutate nothing.
    if (dto.candidate === undefined) {
      return {
        status: 'matched',
        reason: null,
        applied: false,
        candidates: [candidateModel],
        game,
      };
    }

    // The pick must match what re-resolution just returned (the search is
    // re-run on apply, so a stale pick is rejected rather than mis-applied).
    if (
      dto.candidate.source !== candidate.source ||
      dto.candidate.externalId !== candidate.externalId
    ) {
      throw new ConflictException(
        'The selected candidate is no longer available; run the search again',
      );
    }

    const enriched = await this.enrichment.enrichCandidate(
      candidate,
      game.platformId,
      game.edition,
    );
    const updateData = buildReenrichmentUpdate({
      existing: game,
      enriched,
      editedFields: toEditedFields(game.userEditedFields),
    });

    const updated =
      updateData === null
        ? game
        : toGameDetail(
            await this.prisma.game.update({
              where: { id },
              data: updateData,
              include: { platform: { select: PLATFORM_SELECT } },
            }),
          );

    return {
      status: 'matched',
      reason: null,
      applied: updateData !== null,
      candidates: [candidateModel],
      game: updated,
    };
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
