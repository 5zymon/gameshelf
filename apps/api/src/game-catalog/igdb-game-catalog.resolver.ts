import { Injectable } from '@nestjs/common';
import type { RecognizedItem } from '../settings/vision/vision-provider';
import {
  type CatalogCandidate,
  type CatalogPlatform,
  type CatalogResolution,
  type CatalogSearchResult,
  GameCatalogResolver,
  type GameCatalogSource,
} from './game-catalog.resolver';
import { IgdbConfigError, IgdbError } from './igdb.errors';
import {
  IgdbClient,
  type IgdbGame,
  type IgdbMultiplayerMode,
} from './igdb.client';
import { rankTitleMatches, selectConfidentMatch } from './title-match';
import { CATALOG_SEARCH_MAX_RESULTS } from './catalog-search.options';
import { igdbImageUrl } from './igdb-image-url';
import { IGDB_GALLERY_MAX_IMAGES, IGDB_IMAGE_SIZE } from './igdb.options';

// Kept as this module's public surface for existing importers/tests; the actual
// implementation lives with the rest of the title-matching logic.
export { normalizeTitle } from './title-match';

/**
 * IGDB-backed catalog resolver. Calls IGDB once per title (or once per ≤10
 * titles when batched), then accepts the best candidate whose normalized name
 * scores at least `CONFIDENT_MATCH_MIN_SCORE`, never treating a version/sequel
 * difference (`Halo` vs `Halo 2`) as a match.
 */
@Injectable()
export class IgdbGameCatalogResolver
  extends GameCatalogResolver
  implements GameCatalogSource
{
  /** Source label; used in the chain's aggregated reason. */
  readonly label = 'IGDB';

  constructor(private readonly igdb: IgdbClient) {
    super();
  }

  override async resolve(item: RecognizedItem): Promise<CatalogResolution> {
    let games: IgdbGame[];
    try {
      games = await this.igdb.searchGames(item.title);
    } catch (error) {
      return this.errorResolution(error);
    }
    return this.toResolution(item.title, games);
  }

  /** Ranked title search for manual add; a human picks from the list. */
  override async search(query: string): Promise<CatalogSearchResult> {
    let games: IgdbGame[];
    try {
      games = await this.igdb.searchGames(query);
    } catch (error) {
      return this.searchErrorResolution(error);
    }
    return {
      kind: 'matches',
      candidates: rankTitleMatches(query, games)
        .filter((match) => match.score > 0)
        .slice(0, CATALOG_SEARCH_MAX_RESULTS)
        .map((match) => toCandidate(match.game)),
    };
  }

  /**
   * Batch lookup (card 4.3): one multiquery HTTP request per ≤10 titles, then a
   * per-title resolution in the same order as `items`. A batch-level failure
   * applies to every item (transient for retryable, unrecognized otherwise).
   */
  override async resolveBatch(
    items: readonly RecognizedItem[],
  ): Promise<CatalogResolution[]> {
    if (items.length === 0) return [];
    let gamesByTitle: IgdbGame[][];
    try {
      gamesByTitle = await this.igdb.multiqueryGames(
        items.map((item) => item.title),
      );
    } catch (error) {
      return items.map(() => this.errorResolution(error));
    }
    return items.map((item, index) =>
      this.toResolution(item.title, gamesByTitle[index] ?? []),
    );
  }

  private errorResolution(error: unknown): CatalogResolution {
    if (error instanceof IgdbConfigError) {
      return { kind: 'config_error', source: 'igdb', reason: error.message };
    }
    if (error instanceof IgdbError && error.retryable) {
      return { kind: 'transient', reason: error.message };
    }
    return {
      kind: 'unrecognized',
      reason:
        error instanceof IgdbError
          ? error.message
          : 'The game database lookup failed',
    };
  }

  private searchErrorResolution(error: unknown): CatalogSearchResult {
    if (error instanceof IgdbConfigError) {
      return { kind: 'config_error', source: 'igdb', reason: error.message };
    }
    if (error instanceof IgdbError && error.retryable) {
      return { kind: 'transient', reason: error.message };
    }
    return { kind: 'matches', candidates: [] };
  }

  private toResolution(
    title: string,
    games: readonly IgdbGame[],
  ): CatalogResolution {
    const match = selectConfidentMatch(title, games);
    return match === null
      ? { kind: 'unrecognized', reason: 'No IGDB game matched the title' }
      : { kind: 'matched', candidate: toCandidate(match.game) };
  }
}

function toCandidate(game: IgdbGame): CatalogCandidate {
  return {
    externalId: game.id,
    title: game.name,
    releaseYear: releaseYear(game.first_release_date),
    publisher: game.involved_companies?.[0]?.company?.name ?? null,
    genre: game.genres?.[0]?.name ?? null,
    playerCount: playerCount(game.multiplayer_modes),
    coverUrl: igdbImageUrl(game.cover?.url, IGDB_IMAGE_SIZE),
    images: galleryImages(game),
    platforms: (game.platforms ?? []).map(toPlatform),
    source: 'IGDB',
    slug: game.slug ?? null,
    raw: game,
  };
}

/**
 * Ordered, deduped gallery URLs for a candidate: IGDB artworks first (key art),
 * then screenshots (gameplay), each in IGDB order, capped at
 * `IGDB_GALLERY_MAX_IMAGES`. Every URL is normalized to `IGDB_IMAGE_SIZE`.
 */
function galleryImages(game: IgdbGame): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const source of [game.artworks, game.screenshots]) {
    for (const image of source ?? []) {
      const url = igdbImageUrl(image.url, IGDB_IMAGE_SIZE);
      if (url !== null && !seen.has(url)) {
        seen.add(url);
        urls.push(url);
        if (urls.length >= IGDB_GALLERY_MAX_IMAGES) return urls;
      }
    }
  }
  return urls;
}

/**
 * Max supported players across every IGDB multiplayer mode, or `null` when the
 * source exposes none. Only positive integers count; a mode is ignored unless
 * it actually carries a max field, so no value is ever invented.
 */
function playerCount(modes: IgdbMultiplayerMode[] | undefined): number | null {
  let max: number | null = null;
  for (const mode of modes ?? []) {
    for (const value of [
      mode.offlinemax,
      mode.onlinemax,
      mode.offlinecoopmax,
      mode.onlinecoopmax,
    ]) {
      if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
        max = Math.max(max ?? 0, value);
      }
    }
  }
  return max;
}

function toPlatform(platform: {
  id?: number;
  name?: string;
  abbreviation?: string;
}): CatalogPlatform {
  return {
    igdbId: typeof platform.id === 'number' ? platform.id : null,
    name: platform.name ?? '',
    abbreviation: platform.abbreviation ?? null,
  };
}

function releaseYear(timestamp: number | undefined): number | null {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    return null;
  }
  return new Date(timestamp * 1000).getUTCFullYear();
}
