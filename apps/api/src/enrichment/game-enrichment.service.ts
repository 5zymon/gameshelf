import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import type {
  CatalogCandidate,
  CatalogVideo,
} from '../game-catalog/game-catalog.resolver';
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
  platformId: string;
  edition: string | null;
  releaseYear: number | null;
  publisher: string | null;
  genre: string | null;
  playerCount: number | null;
  /** IGDB `summary` (English); hand-editable, provenance tracked. */
  summary: string | null;
  /** IGDB `rating` 0–100 (user-rating average); source-derived only. */
  rating: number | null;
  /** IGDB `rating_count` (user-rating vote count); source-derived only. */
  ratingCount: number | null;
  coverUrl: string | null;
  /** External catalog cover URL (internal; drives the background retry). */
  sourceCoverUrl: string | null;
  /** Locally cached, ordered gallery images. */
  images: GalleryImageInput[];
  /** YouTube videos in IGDB order. */
  videos: CatalogVideo[];
  rawMetadata: string;
  enrichedAt: Date;
  source: CatalogCandidate['source'];
  externalId: number;
  /** IGDB URL slug (internal; the API derives `igdbUrl` from it). */
  igdbSlug: string | null;
}

/** Inputs to the pure candidate→`Game` mapping. */
export interface GameMappingInput {
  candidate: CatalogCandidate;
  platformId: string;
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
    summary: candidate.summary ?? null,
    rating: candidate.rating ?? null,
    ratingCount: candidate.ratingCount ?? null,
    coverUrl,
    sourceCoverUrl: candidate.coverUrl,
    images,
    videos: candidate.videos ?? [],
    rawMetadata: JSON.stringify(candidate.raw),
    enrichedAt: input.fetchedAt ?? new Date(),
    source: candidate.source,
    externalId: candidate.externalId,
    igdbSlug: candidate.slug ?? null,
  };
}

/**
 * A Prisma `game.create` data object with the ordered gallery and videos
 * nested-create. Splitting `images` and `videos` out keeps the flat
 * `EnrichedGameData` usable where only scalar columns are wanted (e.g. the
 * re-enrichment merge input).
 */
export function toGameCreateData(
  enriched: EnrichedGameData,
): Prisma.GameUncheckedCreateInput {
  const { images, videos, ...scalars } = enriched;
  return {
    ...scalars,
    images: {
      create: images.map((image, index) => ({
        position: index,
        url: image.url,
        sourceUrl: image.sourceUrl,
      })),
    },
    videos: {
      create: videos.map((video, index) => ({
        position: index,
        videoId: video.videoId,
        name: video.name,
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
    platformId: string,
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
