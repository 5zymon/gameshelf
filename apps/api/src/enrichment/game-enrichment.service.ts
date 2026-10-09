import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import type { CatalogCandidate } from '../game-catalog/game-catalog.resolver';
import { CoverCacheService } from '../covers/cover-cache.service';

/** One locally cached gallery image (same-origin served path + source URL). */
export interface GalleryImageInput {
  /** Same-origin served path (/api/covers/<file>). */
  url: string;
  /** External IGDB URL (internal; never serialized). */
  sourceUrl: string | null;
}

/** The exact `Game` columns the candidate mapping writes. */
export interface EnrichedGameData {
  title: string;
  platformId: number;
  edition: string | null;
  releaseYear: number | null;
  publisher: string | null;
  genre: string | null;
  playerCount: number | null;
  coverUrl: string | null;
  /** External catalog cover URL (internal; drives the background retry). */
  sourceCoverUrl: string | null;
  /** Locally cached, ordered gallery images. */
  images: GalleryImageInput[];
  rawMetadata: string;
  enrichedAt: Date;
  source: CatalogCandidate['source'];
  externalId: number;
}

/** Inputs to the pure candidate→`Game` mapping. */
export interface GameMappingInput {
  candidate: CatalogCandidate;
  platformId: number;
  edition: string | null;
  /** Already-local served path (`/api/covers/<file>`), or `null`. */
  coverUrl: string | null;
  /** Locally cached gallery images, in display order. */
  images: GalleryImageInput[];
  fetchedAt?: Date;
}

/**
 * Pure mapping: no IO, no defaults, no invented values. Every candidate field is
 * passed through unchanged (a source that does not provide a value leaves the
 * column empty); `edition` is the vision-read value only, never API-derived; and
 * the raw upstream payload is archived verbatim into `rawMetadata`.
 */
export function mapCandidateToGameData(
  input: GameMappingInput,
): EnrichedGameData {
  const { candidate, platformId, edition, coverUrl, images } = input;
  return {
    title: candidate.title,
    platformId,
    edition,
    releaseYear: candidate.releaseYear,
    publisher: candidate.publisher,
    genre: candidate.genre,
    playerCount: candidate.playerCount,
    coverUrl,
    sourceCoverUrl: candidate.coverUrl,
    images,
    rawMetadata: JSON.stringify(candidate.raw),
    enrichedAt: input.fetchedAt ?? new Date(),
    source: candidate.source,
    externalId: candidate.externalId,
  };
}

/**
 * A Prisma `game.create` data object with the ordered gallery nested-create.
 * Splitting `images` out keeps the flat `EnrichedGameData` usable where only
 * scalar columns are wanted (e.g. the re-enrichment merge input).
 */
export function toGameCreateData(
  enriched: EnrichedGameData,
): Prisma.GameUncheckedCreateInput {
  const { images, ...scalars } = enriched;
  return {
    ...scalars,
    images: {
      create: images.map((image, index) => ({
        position: index,
        url: image.url,
        sourceUrl: image.sourceUrl,
      })),
    },
  };
}

/**
 * Resolves a candidate's cover to a locally cached, same-origin path and maps
 * it onto `Game` data. Reusable by the import commit path now and by
 * re-enrichment later. Never throws: a failed cover download yields `null`.
 */
@Injectable()
export class GameEnrichmentService {
  private readonly logger = new Logger(GameEnrichmentService.name);

  constructor(private readonly covers: CoverCacheService) {}

  async enrichCandidate(
    candidate: CatalogCandidate,
    platformId: number,
    edition: string | null,
  ): Promise<EnrichedGameData> {
    const [coverUrl, gallery] = await Promise.all([
      this.covers.cacheFromUrl(candidate.coverUrl),
      Promise.all(
        candidate.images.map(
          async (sourceUrl): Promise<GalleryImageInput | null> => {
            const url = await this.covers.cacheFromUrl(sourceUrl);
            return url === null ? null : { url, sourceUrl };
          },
        ),
      ),
    ]);
    const images = gallery.filter(
      (image): image is GalleryImageInput => image !== null,
    );
    return mapCandidateToGameData({
      candidate,
      platformId,
      edition,
      coverUrl,
      images,
    });
  }
}
