import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  type CatalogCandidate,
  GameCatalogResolver,
} from '../game-catalog/game-catalog.resolver';
import { CatalogSearchService } from '../game-catalog/catalog-search.service';
import {
  GameEnrichmentService,
  toGameCreateData,
} from '../enrichment/game-enrichment.service';
import { CoverCacheService } from '../covers/cover-cache.service';
import { CoverMaintenanceService } from '../covers/cover-maintenance.service';
import { CoverPreviewService } from '../covers/cover-preview.service';
import { COVER_URL_PREFIX } from '../covers/covers.options';
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
import { GameSearchResponseModel } from './dto/game-search-response.model';
import {
  GameDetailModel,
  ListGamesResponseModel,
} from './dto/game-response.model';
import { ListGamesQueryDto } from './dto/list-games-query.dto';
import { SearchGamesQueryDto } from './dto/search-games-query.dto';
import { UpdateGameDto } from './dto/update-game.dto';
import { GAME_ALREADY_IN_CATALOG, type GameIdentity } from './game-identity';
import { GameIdentityService } from './game-identity.service';
import {
  GAME_DETAIL_INCLUDE,
  GAME_LIST_SELECT,
  toGameDetail,
  toGameListItem,
} from './game-detail.mapper';

/** The persisted cover columns a manual cover input resolves to. */
interface CoverWrite {
  coverUrl: string | null;
  sourceCoverUrl: string | null;
}

/** Reason reported when the re-enrich search finds no candidate in any source. */
const REENRICH_NO_MATCH_REASON = 'No game matched the title in any source';

@Injectable()
export class GamesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: GameCatalogResolver, // enrich
    private readonly catalogSearch: CatalogSearchService, // manual-add search
    private readonly identity: GameIdentityService,
    private readonly enrichment: GameEnrichmentService,
    private readonly covers: CoverCacheService,
    private readonly preview: CoverPreviewService,
    private readonly maintenance: CoverMaintenanceService,
  ) {}

  async list(query: ListGamesQueryDto): Promise<ListGamesResponseModel> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = this.buildWhere(query);
    const orderBy = this.buildOrderBy(query);
    const [items, total, platforms, editions] = await Promise.all([
      this.prisma.game.findMany({
        select: GAME_LIST_SELECT,
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
      items: items.map((item) => toGameListItem(item)),
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
      include: GAME_DETAIL_INCLUDE,
    });
    if (!game) {
      throw new NotFoundException(`Game with id ${String(id)} not found`);
    }
    return toGameDetail(game);
  }

  async search(query: SearchGamesQueryDto): Promise<GameSearchResponseModel> {
    const result = await this.catalogSearch.search(query.q ?? '');
    if (result.kind !== 'matches') {
      throw new ServiceUnavailableException(result.reason);
    }
    return {
      candidates: result.candidates.map((candidate) =>
        toEnrichCandidateModel(
          candidate,
          this.preview.previewUrl(candidate.coverUrl),
        ),
      ),
    };
  }

  async create(dto: CreateGameDto): Promise<GameDetailModel> {
    await this.assertPlatformExists(dto.platformId);
    const edition = dto.edition ?? null;

    // 1. Establish the identity, resolving the picked candidate first.
    let candidate: CatalogCandidate | null = null;
    if (dto.candidate !== undefined) {
      const picked = dto.candidate;
      const result = await this.catalogSearch.search(dto.title);
      if (result.kind !== 'matches') {
        throw new ServiceUnavailableException(result.reason);
      }
      candidate =
        result.candidates.find(
          (c) =>
            c.source === picked.source && c.externalId === picked.externalId,
        ) ?? null;
      if (candidate === null) {
        throw new ConflictException(
          'The selected candidate is no longer available; run the search again',
        );
      }
    }
    const identity: GameIdentity =
      candidate === null
        ? {
            title: dto.title,
            platformId: dto.platformId,
            edition,
            source: 'MANUAL',
            externalId: null,
          }
        : {
            title: candidate.title,
            platformId: dto.platformId,
            edition,
            source: candidate.source,
            externalId: candidate.externalId,
          };

    // 2. Duplicate → offer "add another copy" (no write).
    const existing = await this.identity.findExisting(identity);
    if (existing !== null) {
      const existingGame = await this.prisma.game.findUnique({
        where: { id: existing.id },
        include: GAME_DETAIL_INCLUDE,
      });
      if (existingGame !== null) {
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          code: GAME_ALREADY_IN_CATALOG,
          message: 'This game is already in the catalog — add another copy?',
          game: toGameDetail(existingGame),
        });
      }
      // row deleted in the race window: fall through and create
    }

    // 3. Linked path: reuse the import mapping (candidate is source of truth for
    //    metadata + cover; platform/edition are the user's confirmed inputs).
    if (candidate !== null) {
      const enriched = await this.enrichment.enrichCandidate(
        candidate,
        dto.platformId,
        edition,
      );
      const game = await this.prisma.game.create({
        data: toGameCreateData(enriched),
        include: GAME_DETAIL_INCLUDE,
      });
      return toGameDetail(game);
    }

    // 4. Unlinked typed path: current behavior, now guarded by the identity check.
    const editedNow = TRACKED_METADATA_FIELDS.filter(
      (field) => dto[field] !== undefined,
    );
    const cover = await this.resolveManualCover(dto.coverUrl);
    const game = await this.prisma.game.create({
      data: {
        title: dto.title,
        platformId: dto.platformId,
        edition,
        releaseYear: dto.releaseYear ?? null,
        publisher: dto.publisher ?? null,
        genre: dto.genre ?? null,
        playerCount: dto.playerCount ?? null,
        summary: dto.summary ?? null,
        coverUrl: cover.coverUrl,
        sourceCoverUrl: cover.sourceCoverUrl,
        ...(editedNow.length > 0 && {
          userEditedFields: serializeEditedFields(editedNow),
        }),
      },
      include: GAME_DETAIL_INCLUDE,
    });
    return toGameDetail(game);
  }

  async addCopy(id: number): Promise<GameDetailModel> {
    const existing = await this.prisma.game.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException(`Game with id ${String(id)} not found`);
    }
    const game = await this.prisma.game.update({
      where: { id },
      data: { copyCount: { increment: 1 } }, // atomic
      include: GAME_DETAIL_INCLUDE,
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
      select: {
        id: true,
        userEditedFields: true,
        coverUrl: true,
        sourceCoverUrl: true,
      },
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
    // A cover provided as an external URL is downloaded and kept same-origin;
    // an explicit `null` clears both the local file and the stored source link.
    let coverWrite: CoverWrite | null = null;
    if (dto.coverUrl !== undefined) {
      // `@IsOptional` lets an explicit `null` through at runtime even though the
      // static type is `string | undefined` — an explicit null clears the cover.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      const explicitNull = dto.coverUrl === null;
      coverWrite = explicitNull
        ? { coverUrl: null, sourceCoverUrl: null }
        : await this.resolveManualCover(dto.coverUrl, existing);
    }
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
        ...(dto.summary !== undefined && { summary: dto.summary }),
        ...(coverWrite !== null && {
          coverUrl: coverWrite.coverUrl,
          sourceCoverUrl: coverWrite.sourceCoverUrl,
        }),
        // Fixing the platform confirms it, so clear any "unverified" flag.
        ...(dto.platformId !== undefined && { platformUnverified: false }),
        ...(editedNow.length > 0 && {
          userEditedFields: serializeEditedFields(
            mergeEditedFields(existing.userEditedFields, editedNow),
          ),
        }),
      },
      include: GAME_DETAIL_INCLUDE,
    });
    if (coverWrite !== null && existing.coverUrl !== game.coverUrl) {
      // The cover moved away from this game; its gallery may still point at the
      // old file, so exclude the game only from the cover count.
      await this.maintenance.removeIfUnreferenced(existing.coverUrl, {
        exceptCoverGameId: id,
      });
    }
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
    const raw = await this.prisma.game.findUnique({
      where: { id },
      include: GAME_DETAIL_INCLUDE,
    });
    if (!raw) {
      throw new NotFoundException(`Game with id ${String(id)} not found`);
    }
    const game = toGameDetail(raw);

    const search = await this.catalog.search(raw.title);

    if (search.kind === 'transient' || search.kind === 'config_error') {
      throw new ServiceUnavailableException(search.reason);
    }

    // Ranked list (IGDB returns ≤ CATALOG_SEARCH_MAX_RESULTS = 10, best first).
    // Each candidate's external cover is proxied through a signed same-origin
    // preview URL — the external host never reaches the browser.
    const candidates = search.candidates;
    const candidateModels = candidates.map((candidate) =>
      toEnrichCandidateModel(
        candidate,
        this.preview.previewUrl(candidate.coverUrl),
      ),
    );

    // No candidate to offer or apply: the title is still unresolved. A stale
    // pick therefore reports unrecognized (nothing is available), not 409.
    if (candidates.length === 0) {
      return {
        status: 'unrecognized',
        reason: REENRICH_NO_MATCH_REASON,
        applied: false,
        candidates: [],
        game,
      };
    }

    // Search step: report the ranked list, mutate nothing.
    if (dto.candidate === undefined) {
      return {
        status: 'matched',
        reason: null,
        applied: false,
        candidates: candidateModels,
        game,
      };
    }

    // Apply step: the pick must appear in the fresh list (the search is re-run
    // on apply, so a stale pick is rejected rather than mis-applied). Any
    // candidate in the list is applicable, not only the top-ranked one.
    const picked = dto.candidate;
    const candidate = candidates.find(
      (c) => c.source === picked.source && c.externalId === picked.externalId,
    );
    if (candidate === undefined) {
      throw new ConflictException(
        'The selected candidate is no longer available; run the search again',
      );
    }

    const enriched = await this.enrichment.enrichCandidate(
      candidate,
      raw.platformId,
      raw.edition,
    );
    const updateData = buildReenrichmentUpdate({
      existing: raw,
      enriched,
      editedFields: toEditedFields(raw.userEditedFields),
    });

    // `enrichCandidate` downloaded the candidate cover up front, but the merge
    // policy refuses to write `coverUrl` when the field was hand-edited (or the
    // candidate cover equals the current one). When the downloaded file was not
    // adopted and is not the file the game already uses, remove it so a skipped
    // re-enrichment cannot orphan a cover file. Ref-counted: a shared/live
    // cover is never deleted.
    const candidateCover = enriched.coverUrl;
    if (
      candidateCover !== null &&
      candidateCover !== raw.coverUrl &&
      !(updateData !== null && updateData.coverUrl === candidateCover)
    ) {
      // The downloaded file was not adopted as this game's cover; exclude the
      // game only from the cover count so a coincidental gallery reference still
      // keeps the file.
      await this.maintenance.removeIfUnreferenced(candidateCover, {
        exceptCoverGameId: id,
      });
    }

    const updated =
      updateData === null
        ? game
        : toGameDetail(
            await this.prisma.game.update({
              where: { id },
              data: updateData,
              include: GAME_DETAIL_INCLUDE,
            }),
          );

    // Ref-counted deletion: drop the replaced file only when no other game
    // still points at it (e.g. a sibling imported from the same candidate).
    // The game's unchanged gallery may still reference the old cover, so it is
    // excluded only from the cover count.
    if (raw.coverUrl !== updated.coverUrl) {
      await this.maintenance.removeIfUnreferenced(raw.coverUrl, {
        exceptCoverGameId: id,
      });
    }

    // The gallery rows now reflect the new image set, so any previous file not
    // kept by the replacement can be removed (ref-counted: a file still
    // referenced by another game or gallery row is kept). A dropped gallery file
    // may still be this game's current cover, so exclude the game only from the
    // gallery count.
    if (updateData?.images !== undefined) {
      const kept = new Set(enriched.images.map((image) => image.url));
      for (const previous of raw.images) {
        if (!kept.has(previous.url)) {
          await this.maintenance.removeIfUnreferenced(previous.url, {
            exceptImageGameId: id,
          });
        }
      }
    }

    return {
      status: 'matched',
      reason: null,
      applied: updateData !== null,
      candidates: candidateModels,
      game: updated,
    };
  }

  async remove(id: number): Promise<void> {
    const existing = await this.prisma.game.findUnique({
      where: { id },
      select: { id: true, coverUrl: true, images: { select: { url: true } } },
    });
    if (!existing) {
      throw new NotFoundException(`Game with id ${String(id)} not found`);
    }
    await this.prisma.game.delete({ where: { id } });
    await this.maintenance.removeIfUnreferenced(existing.coverUrl);
    for (const image of existing.images) {
      await this.maintenance.removeIfUnreferenced(image.url);
    }
  }

  /**
   * Resolves a manual `coverUrl` input to the persisted columns: a same-origin
   * `/api/covers/...` path is kept as-is, any other URL is downloaded into the
   * local cache (with the external URL stored as `sourceCoverUrl` for retries),
   * and an omitted/blank value clears both. A failed download leaves
   * `coverUrl: null` and the source link set, so the sweep can retry it.
   *
   * On an update, re-submitting the game's **current** local cover path keeps
   * the existing `sourceCoverUrl` (so re-pasting a path does not drop the
   * recovery link); only an explicit `null` clears it.
   */
  private async resolveManualCover(
    input: string | null | undefined,
    previous?: { coverUrl: string | null; sourceCoverUrl: string | null },
  ): Promise<CoverWrite> {
    if (input === undefined || input === null || input.trim() === '') {
      return { coverUrl: null, sourceCoverUrl: null };
    }
    if (input.startsWith(`${COVER_URL_PREFIX}/`)) {
      const preserved =
        previous?.coverUrl === input ? previous.sourceCoverUrl : null;
      return { coverUrl: input, sourceCoverUrl: preserved };
    }
    const served = await this.covers.cacheFromUrl(input);
    return { coverUrl: served, sourceCoverUrl: input };
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
