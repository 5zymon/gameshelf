import { Injectable } from '@nestjs/common';
import type { RecognizedItem } from '../settings/vision/vision-provider';
import {
  type CatalogCandidate,
  type CatalogPlatform,
  type CatalogResolution,
  GameCatalogResolver,
} from './game-catalog.resolver';
import { IgdbError } from './igdb.errors';
import { IgdbClient, type IgdbGame } from './igdb.client';

/** Minimum shorter/longer length ratio for a containment match. */
export const CONTAINMENT_MIN_RATIO = 0.8;

/**
 * IGDB-backed catalog resolver. Calls IGDB once per title, then accepts the
 * first candidate whose normalized name equals the recognized title, or a
 * containment match whose length ratio is at least `CONTAINMENT_MIN_RATIO`.
 */
@Injectable()
export class IgdbGameCatalogResolver extends GameCatalogResolver {
  constructor(private readonly igdb: IgdbClient) {
    super();
  }

  async resolve(item: RecognizedItem): Promise<CatalogResolution> {
    let games: IgdbGame[];
    try {
      games = await this.igdb.searchGames(item.title);
    } catch (error) {
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

    const target = normalizeTitle(item.title);
    for (const game of games) {
      if (normalizeTitle(game.name) === target) {
        return { kind: 'matched', candidate: toCandidate(game) };
      }
    }
    for (const game of games) {
      const candidate = normalizeTitle(game.name);
      if (candidate === '' || target === '') {
        continue;
      }
      const shorter = Math.min(candidate.length, target.length);
      const longer = Math.max(candidate.length, target.length);
      if (
        candidate.includes(target) &&
        shorter / longer >= CONTAINMENT_MIN_RATIO
      ) {
        return { kind: 'matched', candidate: toCandidate(game) };
      }
    }
    return { kind: 'unrecognized', reason: 'No IGDB game matched the title' };
  }
}

/** Lowercases, strips diacritics/punctuation, and collapses whitespace. */
export function normalizeTitle(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
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
