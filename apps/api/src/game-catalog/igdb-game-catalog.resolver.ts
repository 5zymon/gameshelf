import { Injectable } from '@nestjs/common';
import type { RecognizedItem } from '../settings/vision/vision-provider';
import {
  type CatalogCandidate,
  type CatalogPlatform,
  type CatalogResolution,
  GameCatalogResolver,
  type GameCatalogSource,
} from './game-catalog.resolver';
import { IgdbConfigError, IgdbError } from './igdb.errors';
import { IgdbClient, type IgdbGame } from './igdb.client';
import { selectConfidentMatch } from './title-match';

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
    coverUrl: normalizeCoverUrl(game.cover?.url ?? null),
    platforms: (game.platforms ?? []).map(toPlatform),
    source: 'IGDB',
    raw: game,
  };
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

/** IGDB returns protocol-relative cover URLs; make them absolute. */
function normalizeCoverUrl(url: string | null): string | null {
  if (url === null || url === '') {
    return null;
  }
  return url.startsWith('//') ? `https:${url}` : url;
}
