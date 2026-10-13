import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogSearchService } from '../game-catalog/catalog-search.service';
import type { CatalogCandidate } from '../game-catalog/game-catalog.resolver';
import { toEnrichCandidateModel } from '../games/dto/enrich-game-response.model';
import type { GameSearchResponseModel } from '../games/dto/game-search-response.model';
import { GameIdentityService } from '../games/game-identity.service';
import type { GameIdentity } from '../games/game-identity';
import { GAME_DETAIL_INCLUDE, toGameDetail } from '../games/game-detail.mapper';
import type { GameDetailModel } from '../games/dto/game-response.model';
import {
  GameEnrichmentService,
  toGameCreateData,
} from '../enrichment/game-enrichment.service';
import { CoverMaintenanceService } from '../covers/cover-maintenance.service';
import { CoverPreviewService } from '../covers/cover-preview.service';
import {
  ImportJobsService,
  parseCandidateRecords,
} from './import-jobs.service';
import { PickUnrecognizedCandidateDto } from './dto/pick-unrecognized-candidate.dto';
import { SearchUnrecognizedItemQueryDto } from './dto/search-unrecognized-item-query.dto';
import { preferPlatform, type PreferredPlatform } from './platform-preference';

/**
 * Resolves a flagged (unrecognized) import item by picking a catalog candidate:
 * one of its tied candidates (card 105) or a candidate from a re-search with a
 * corrected title. Behaves like "Add manually": it creates the game and marks
 * the item reviewed, without touching `recognized_items` or the job counters.
 * The picked candidate is re-confirmed against a fresh catalog search before any
 * game is written, so a candidate that dropped out of the source can never be
 * imported blindly. `search` runs the same catalog search for the review UI,
 * listing candidates on a preferred platform first.
 */
@Injectable()
export class UnrecognizedItemPickService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogSearch: CatalogSearchService,
    private readonly importJobs: ImportJobsService,
    private readonly identity: GameIdentityService,
    private readonly enrichment: GameEnrichmentService,
    private readonly maintenance: CoverMaintenanceService,
    private readonly preview: CoverPreviewService,
  ) {}

  async pick(
    jobId: string,
    itemId: string,
    ref: PickUnrecognizedCandidateDto,
  ): Promise<GameDetailModel> {
    // 1. Load the item; 404 when missing or from another job, 409 when reviewed.
    const item = await this.loadOpenItem(jobId, itemId);

    // 2. Validate a user-confirmed platform before any search or write, like
    //    `search`: an unknown id is a 400, never an upstream catalog call.
    if (ref.platformId !== undefined) {
      await this.loadPlatform(ref.platformId);
    }

    // 3. The ref must be one of the item's stored tied candidates — unless it
    //    came from a re-search (`query` set; those candidates are never stored).
    let confirmQuery: string;
    if (ref.query !== undefined) {
      confirmQuery = ref.query;
    } else {
      const records = parseCandidateRecords(item.candidates);
      const picked = records.find(
        (record) =>
          record.source === ref.source && record.externalId === ref.externalId,
      );
      if (picked === undefined) {
        throw new BadRequestException(
          "The selected candidate is not one of this item's tied candidates",
        );
      }
      confirmQuery = picked.title;
    }

    // 4. Re-confirm the candidate from the source (mirrors GamesService.create).
    const search = await this.catalogSearch.search(confirmQuery);
    if (search.kind !== 'matches') {
      throw new ServiceUnavailableException(search.reason);
    }
    const candidate: CatalogCandidate | null =
      search.candidates.find(
        (c) => c.source === ref.source && c.externalId === ref.externalId,
      ) ?? null;
    if (candidate === null) {
      throw new ConflictException(
        'The selected candidate is no longer available',
      );
    }

    // 5. Resolve the platform: a user-confirmed platformId wins; otherwise the
    //    photo platform is authoritative, then the candidate.
    let platformId: string;
    let platformUnverified: boolean;
    if (ref.platformId !== undefined) {
      platformId = ref.platformId;
      platformUnverified = false;
    } else {
      const resolved = await this.importJobs.resolvePlatformId(
        candidate.platforms,
        item.rawPlatform,
      );
      if (resolved === null) {
        throw new ConflictException(
          'No usable platform for this candidate — add it manually',
        );
      }
      platformId = resolved.platformId;
      platformUnverified = resolved.provenance === 'catalog';
    }

    // 6. Identity: an existing game is linked (never a second row, no copy
    //    increment — the same import semantics as commitImportBatch).
    const identity: GameIdentity = {
      title: candidate.title,
      platformId,
      edition: item.rawEdition,
      source: candidate.source,
      externalId: candidate.externalId,
    };
    const existing = await this.identity.findExisting(identity);
    if (existing !== null) {
      const existingGame = await this.prisma.game.findUnique({
        where: { id: existing.id },
        include: GAME_DETAIL_INCLUDE,
      });
      if (existingGame !== null) {
        const claim = await this.prisma.unrecognizedItem.updateMany({
          where: { id: itemId, dismissedAt: null },
          data: { dismissedAt: new Date() },
        });
        if (claim.count === 0) {
          throw new ConflictException('This flagged item was already reviewed');
        }
        return toGameDetail(existingGame);
      }
      // The row was deleted in the race window: fall through and create.
    }

    // 7. Enrich (download cover/gallery) OUTSIDE the transaction, then commit.
    const enriched = await this.enrichment.enrichCandidate(
      candidate,
      platformId,
      item.rawEdition,
    );
    const downloaded: (string | null)[] = [
      enriched.coverUrl,
      ...enriched.images.map((image) => image.url),
    ];
    let gameId: string;
    let adopted = false;
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // Re-check inside the transaction: a game created by a racing pick is
        // reused instead of duplicated.
        const recheck = await this.identity.findExisting(identity, tx);
        let id: string;
        if (recheck !== null) {
          id = recheck.id;
          adopted = false; // the downloaded assets are not adopted
        } else {
          id = (
            await tx.game.create({
              data: {
                ...toGameCreateData(enriched),
                platformUnverified,
              },
            })
          ).id;
          adopted = true;
        }
        const claim = await tx.unrecognizedItem.updateMany({
          where: { id: itemId, dismissedAt: null },
          data: { dismissedAt: new Date() },
        });
        if (claim.count === 0) {
          // A racing pick already reviewed the item: roll back (undoing any
          // game we just created).
          throw new ConflictException('This flagged item was already reviewed');
        }
        return { id, adopted };
      });
      gameId = result.id;
      adopted = result.adopted;
    } catch (error) {
      // Rollback: nothing was committed, so the downloaded assets are orphaned.
      await this.cleanupAssets(downloaded);
      throw error;
    }
    // Success: clean up only the assets that were not adopted (the duplicate).
    if (!adopted) {
      await this.cleanupAssets(downloaded);
    }

    // 8. Return the created/linked game.
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      include: GAME_DETAIL_INCLUDE,
    });
    if (game === null) {
      throw new NotFoundException(`Game with id ${gameId} not found`);
    }
    return toGameDetail(game);
  }

  /**
   * Re-search the catalog for a flagged item with a corrected title (the review
   * UI's "Search again"). Runs through `CatalogSearchService` for the minimum
   * length, TTL cache and request coalescing; candidates on `platformId` are
   * listed first (a boost, never a filter). 404/409 for a stale item, 400 for
   * an unknown platform, 503 while the source is down.
   */
  async search(
    jobId: string,
    itemId: string,
    query: SearchUnrecognizedItemQueryDto,
  ): Promise<GameSearchResponseModel> {
    await this.loadOpenItem(jobId, itemId); // 404 / 409
    const platform =
      query.platformId === undefined
        ? null
        : await this.loadPlatform(query.platformId); // 400
    const result = await this.catalogSearch.search(query.q ?? '');
    if (result.kind !== 'matches') {
      throw new ServiceUnavailableException(result.reason); // 503
    }
    return {
      candidates: preferPlatform(result.candidates, platform).map((candidate) =>
        toEnrichCandidateModel(
          candidate,
          this.preview.previewUrl(candidate.coverUrl),
        ),
      ),
    };
  }

  /**
   * Loads the item, scoped to its job: 404 when missing or from another job,
   * 409 when already reviewed. Shared by `search` and `pick` so a stale item is
   * rejected before any search or write.
   */
  private async loadOpenItem(
    jobId: string,
    itemId: string,
  ): Promise<{
    id: string;
    importJobId: string;
    rawTitle: string;
    rawPlatform: string | null;
    rawEdition: string | null;
    candidates: Prisma.JsonValue | null;
    dismissedAt: Date | null;
  }> {
    const item = await this.prisma.unrecognizedItem.findUnique({
      where: { id: itemId },
      select: {
        id: true,
        importJobId: true,
        rawTitle: true,
        rawPlatform: true,
        rawEdition: true,
        candidates: true,
        dismissedAt: true,
      },
    });
    if (item?.importJobId !== jobId) {
      throw new NotFoundException(
        `Unrecognized item with id ${itemId} not found in import job ${jobId}`,
      );
    }
    if (item.dismissedAt !== null) {
      throw new ConflictException('This flagged item was already reviewed');
    }
    return item;
  }

  /**
   * Loads a local platform in the shape the platform matcher expects. Unknown
   * id → 400, the same message as `GamesService.assertPlatformExists`.
   */
  private async loadPlatform(platformId: string): Promise<PreferredPlatform> {
    const platform = await this.prisma.platform.findUnique({
      where: { id: platformId },
      select: {
        id: true,
        name: true,
        abbreviation: true,
        alternativeName: true,
        igdbId: true,
        aliases: { select: { name: true } },
      },
    });
    if (platform === null) {
      throw new BadRequestException(
        `Platform with id ${platformId} does not exist`,
      );
    }
    return {
      ...platform,
      aliases: platform.aliases.map((alias) => alias.name),
    };
  }

  /**
   * Ref-counted removal of downloaded cover/gallery files that were not adopted
   * (a shared/live file is kept). Best-effort per file; a failure never masks
   * the pick's own outcome.
   */
  private async cleanupAssets(urls: (string | null)[]): Promise<void> {
    for (const url of urls) {
      if (url !== null) {
        await this.maintenance.removeIfUnreferenced(url);
      }
    }
  }
}
