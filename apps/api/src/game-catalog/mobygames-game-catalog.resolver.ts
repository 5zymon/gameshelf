import { Injectable } from '@nestjs/common';
import type { RecognizedItem } from '../settings/vision/vision-provider';
import {
  type CatalogCandidate,
  type CatalogPlatform,
  type CatalogResolution,
  GameCatalogResolver,
  type GameCatalogSource,
} from './game-catalog.resolver';
import { MobygamesConfigError, MobygamesError } from './mobygames.errors';
import {
  MobygamesClient,
  type MobygameGame,
  type MobygamePlatform,
} from './mobygames.client';
import { selectConfidentMatch } from './title-match';

/**
 * MobyGames-backed catalog source (card 4.5). Consulted only after IGDB returns
 * `unrecognized`; the shared `selectConfidentMatch` acceptance and the
 * `CatalogCandidate` shape are identical to IGDB's, so the pipeline is unaware
 * which source matched. `resolveBatch` is intentionally **not** overridden: the
 * inherited sequential default is one request per item, which matches the
 * 1 req/s budget.
 */
@Injectable()
export class MobygamesGameCatalogResolver
  extends GameCatalogResolver
  implements GameCatalogSource
{
  /** Source label; used in the chain's aggregated reason. */
  readonly label = 'MobyGames';

  constructor(private readonly client: MobygamesClient) {
    super();
  }

  override async resolve(item: RecognizedItem): Promise<CatalogResolution> {
    let games: MobygameGame[];
    try {
      games = await this.client.searchGames(item.title);
    } catch (error) {
      return this.errorResolution(error);
    }
    return this.mapResolution(item.title, games);
  }

  /**
   * Maps an already-fetched list to a resolution, **never throwing**. A
   * malformed nested row (null element, unexpected shape) degrades to an
   * item-level `unrecognized` instead of an unrecoverable whole-job failure —
   * the ticket's "never fail jobs" principle.
   */
  private mapResolution(
    title: string,
    games: readonly MobygameGame[],
  ): CatalogResolution {
    try {
      return this.toResolution(title, games);
    } catch {
      return {
        kind: 'unrecognized',
        reason: 'MobyGames returned a malformed game payload',
      };
    }
  }

  private errorResolution(error: unknown): CatalogResolution {
    if (error instanceof MobygamesConfigError) {
      return {
        kind: 'config_error',
        source: 'mobygames',
        reason: error.message,
      };
    }
    if (error instanceof MobygamesError && error.retryable) {
      return { kind: 'transient', reason: error.message };
    }
    return {
      kind: 'unrecognized',
      reason:
        error instanceof MobygamesError
          ? error.message
          : 'The game database lookup failed',
    };
  }

  private toResolution(
    title: string,
    games: readonly MobygameGame[],
  ): CatalogResolution {
    const match = selectConfidentMatch(
      title,
      games.map((game) => ({ name: game.title, game })),
    );
    return match === null
      ? { kind: 'unrecognized', reason: 'No MobyGames game matched the title' }
      : { kind: 'matched', candidate: toCandidate(match.game.game) };
  }
}

function toCandidate(game: MobygameGame): CatalogCandidate {
  return {
    externalId: game.game_id,
    title: game.title,
    releaseYear: releaseYear(game),
    publisher: publisher(game),
    genre: game.genres?.[0]?.name ?? null,
    // The v2 search `include` exposes no player-count field; inventing one is
    // forbidden, so a MobyGames import always leaves `playerCount` null.
    playerCount: null,
    coverUrl: coverUrl(game),
    platforms: objects(game.platforms).map(toPlatform),
    source: 'MobyGames',
    raw: game,
  };
}

/**
 * Drops null/undefined/non-object entries before a nested field is
 * dereferenced, so a malformed upstream payload cannot throw a `TypeError`.
 */
function objects<T extends object>(values: readonly T[] | undefined): T[] {
  return (values ?? []).filter((value: unknown) => {
    return typeof value === 'object' && value !== null;
  });
}

function toPlatform(platform: MobygamePlatform): CatalogPlatform {
  return {
    // Moby platform ids are not IGDB ids; the pipeline matches by name instead.
    igdbId: null,
    name: platform.name ?? '',
    abbreviation: null,
  };
}

/** Earliest four-digit year across platform and release dates, or `null`. */
function releaseYear(game: MobygameGame): number | null {
  const dates: string[] = [];
  for (const platform of objects(game.platforms)) {
    if (typeof platform.release_date === 'string') {
      dates.push(platform.release_date);
    }
    for (const release of objects(platform.releases)) {
      if (typeof release.release_date === 'string') {
        dates.push(release.release_date);
      }
    }
  }
  let earliest: number | null = null;
  for (const date of dates) {
    const match = /\d{4}/.exec(date);
    if (match === null) continue;
    const year = Number(match[0]);
    if (!Number.isFinite(year)) continue;
    earliest = Math.min(year, earliest ?? Number.POSITIVE_INFINITY);
  }
  return earliest;
}

/** First publisher-role company name, else the first company name, else null. */
function publisher(game: MobygameGame): string | null {
  let firstCompany: string | null = null;
  for (const platform of objects(game.platforms)) {
    for (const release of objects(platform.releases)) {
      for (const company of objects(release.companies)) {
        const name = company.company_name;
        if (typeof name !== 'string' || name.trim() === '') continue;
        firstCompany ??= name;
        if (typeof company.role === 'string' && /publish/i.test(company.role)) {
          return name;
        }
      }
    }
  }
  return firstCompany;
}

/** First non-empty cover image URL, or `null`. */
function coverUrl(game: MobygameGame): string | null {
  for (const cover of objects(game.covers)) {
    for (const image of objects(cover.images)) {
      const url = image.image_url ?? image.original_url ?? image.thumbnail_url;
      if (typeof url === 'string' && url !== '') return url;
    }
  }
  return null;
}
