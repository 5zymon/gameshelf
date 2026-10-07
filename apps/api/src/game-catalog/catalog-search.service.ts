import { Injectable } from '@nestjs/common';
import { normalizeTitle } from './title-match';
import {
  type CatalogCandidate,
  type CatalogSearchResult,
  GameCatalogResolver,
} from './game-catalog.resolver';
import {
  CATALOG_SEARCH_CACHE_TTL_MS,
  CATALOG_SEARCH_MAX_CACHE_ENTRIES,
  CATALOG_SEARCH_MIN_QUERY_LENGTH,
} from './catalog-search.options';

/**
 * Server-side debounce protection for manual-add title search. A short-TTL
 * in-process cache absorbs keystrokes, identical in-flight lookups are
 * coalesced into one upstream call, and a query below the minimum normalized
 * length returns an empty result without touching the game database. Errors are
 * never cached.
 */
@Injectable()
export class CatalogSearchService {
  private readonly cache = new Map<
    string,
    { expiresAt: number; candidates: readonly CatalogCandidate[] }
  >();
  private readonly inFlight = new Map<string, Promise<CatalogSearchResult>>();

  constructor(private readonly catalog: GameCatalogResolver) {}

  async search(query: string): Promise<CatalogSearchResult> {
    const key = normalizeTitle(query);
    if (key.length < CATALOG_SEARCH_MIN_QUERY_LENGTH) {
      return { kind: 'matches', candidates: [] }; // API-side minimum length
    }
    const cached = this.cache.get(key);
    if (cached !== undefined && cached.expiresAt > Date.now()) {
      return { kind: 'matches', candidates: [...cached.candidates] };
    }
    const pending = this.inFlight.get(key);
    if (pending !== undefined) return pending; // coalesce identical keystrokes
    const promise = this.catalog
      .search(query.trim())
      .then((result) => {
        if (result.kind === 'matches') this.store(key, result.candidates);
        return result; // errors are never cached
      })
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, promise);
    return promise;
  }

  private store(key: string, candidates: readonly CatalogCandidate[]): void {
    if (this.cache.size >= CATALOG_SEARCH_MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, {
      expiresAt: Date.now() + CATALOG_SEARCH_CACHE_TTL_MS,
      candidates,
    });
  }
}
