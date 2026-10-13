import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogSearchService } from '../game-catalog/catalog-search.service';
import type { CatalogCandidate } from '../game-catalog/game-catalog.resolver';
import { GameIdentityService } from '../games/game-identity.service';
import type { GameIdentity } from '../games/game-identity';
import { GAME_DETAIL_INCLUDE, toGameDetail } from '../games/game-detail.mapper';
import type { GameDetailModel } from '../games/dto/game-response.model';
import {
  GameEnrichmentService,
  toGameCreateData,
} from '../enrichment/game-enrichment.service';
import { CoverMaintenanceService } from '../covers/cover-maintenance.service';
import {
  ImportJobsService,
  parseCandidateRecords,
} from './import-jobs.service';
import { PickUnrecognizedCandidateDto } from './dto/pick-unrecognized-candidate.dto';

/**
 * Resolves a flagged (unrecognized) import item by picking one of its tied
 * catalog candidates (card 105). Behaves like "Add manually": it creates the
 * game and marks the item reviewed, without touching `recognized_items` or the
 * job counters. The picked candidate is re-confirmed against a fresh catalog
 * search before any game is written, so a candidate that dropped out of the
 * source can never be imported blindly.
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
  ) {}

  async pick(
    jobId: string,
    itemId: string,
    ref: PickUnrecognizedCandidateDto,
  ): Promise<GameDetailModel> {
    // 1. Load the item; 404 when missing or from another job, 409 when reviewed.
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

    // 2. The ref must be one of the item's stored tied candidates.
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

    // 3. Re-confirm the candidate from the source (mirrors GamesService.create).
    const search = await this.catalogSearch.search(picked.title);
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

    // 4. Resolve the platform (photo platform authoritative, else candidate).
    const resolved = await this.importJobs.resolvePlatformId(
      candidate.platforms,
      item.rawPlatform,
    );
    if (resolved === null) {
      throw new ConflictException(
        'No usable platform for this candidate — add it manually',
      );
    }
    const { platformId, provenance } = resolved;

    // 5. Identity: an existing game is linked (never a second row, no copy
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

    // 6. Enrich (download cover/gallery) OUTSIDE the transaction, then commit.
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
                platformUnverified: provenance === 'catalog',
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

    // 7. Return the created/linked game.
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
