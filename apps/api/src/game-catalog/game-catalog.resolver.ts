import type { RecognizedItem } from '../settings/vision/vision-provider';

/** One external platform a candidate is known to run on. */
export interface CatalogPlatform {
  /** IGDB platform id — the canonical link to a seeded `Platform.igdbId`. */
  igdbId: number | null;
  name: string;
  abbreviation: string | null;
}

/** Which catalog produced a candidate; maps 1:1 onto the Prisma `GameSource` enum. */
export type CatalogSource = 'IGDB' | 'MobyGames';

/** A candidate game returned by the external database. */
export interface CatalogCandidate {
  externalId: number;
  title: string;
  releaseYear: number | null;
  publisher: string | null;
  genre: string | null;
  coverUrl: string | null;
  platforms: CatalogPlatform[];
  source: CatalogSource;
  /** Raw upstream payload, archived into `Game.rawMetadata`. */
  raw: unknown;
}

/** Which catalog source reported a configuration error (IGDB or MobyGames). */
export type GameCatalogConfigSource = 'igdb' | 'mobygames';

/**
 * Outcome of validating one recognized title:
 * - `matched` — a candidate passed acceptance;
 * - `unrecognized` — no candidate will ever match (permanent);
 * - `transient` — the lookup failed and a retry may succeed (e.g. 429);
 * - `config_error` — rejected/absent credentials; the pipeline must stop and
 *   pause, not flag the title.
 */
export type CatalogResolution =
  | { kind: 'matched'; candidate: CatalogCandidate }
  | { kind: 'unrecognized'; reason: string }
  | { kind: 'transient'; reason: string }
  | { kind: 'config_error'; source: GameCatalogConfigSource; reason: string };

/**
 * One external game-database source in the ordered validation chain.
 * A source returns `matched`, `unrecognized` (no candidate in *this* source),
 * or `transient` (lookup failed, retry may succeed). It never throws: errors are
 * mapped to a resolution. `IgdbGameCatalogResolver` implements this today;
 * ticket 4.5 plugs the MobyGames source in behind the same contract.
 */
export interface GameCatalogSource {
  /** Stable label used in the aggregated "no source matched" reason. */
  readonly label: string;
  resolve(item: RecognizedItem): Promise<CatalogResolution>;
}

/** Nest DI token for the ordered source list (array order = validation order). */
export const GAME_CATALOG_SOURCES = 'GAME_CATALOG_SOURCES';

/**
 * Port for external game-database validation. The production binding
 * (`ChainedGameCatalogResolver`) composes the ordered source list behind this
 * port; ticket 4.5 adds a source to `GAME_CATALOG_SOURCES` without touching the
 * pipeline.
 */
export abstract class GameCatalogResolver {
  abstract resolve(item: RecognizedItem): Promise<CatalogResolution>;

  /**
   * Validates a batch of titles. The IGDB implementation overrides this with one
   * multiquery request per ≤10 titles (card 4.3); the default is sequential and
   * exists so the port stays usable by any resolver that does not batch.
   */
  async resolveBatch(
    items: readonly RecognizedItem[],
  ): Promise<CatalogResolution[]> {
    const results: CatalogResolution[] = [];
    for (const item of items) {
      results.push(await this.resolve(item));
    }
    return results;
  }
}
