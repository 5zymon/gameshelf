import type { RecognizedItem } from '../settings/vision/vision-provider';

/** One external platform a candidate is known to run on. */
export interface CatalogPlatform {
  /** IGDB platform id — the canonical link to a seeded `Platform.igdbId`. */
  igdbId: number | null;
  name: string;
  abbreviation: string | null;
}

/** A candidate game returned by the external database. */
export interface CatalogCandidate {
  externalId: number;
  title: string;
  releaseYear: number | null;
  publisher: string | null;
  genre: string | null;
  coverUrl: string | null;
  platforms: CatalogPlatform[];
  /** Raw upstream payload, archived into `Game.rawMetadata`. */
  raw: unknown;
}

/**
 * Outcome of validating one recognized title:
 * - `matched` — a candidate passed acceptance;
 * - `unrecognized` — no candidate will ever match (permanent);
 * - `transient` — the lookup failed and a retry may succeed (e.g. 429).
 */
export type CatalogResolution =
  | { kind: 'matched'; candidate: CatalogCandidate }
  | { kind: 'unrecognized'; reason: string }
  | { kind: 'transient'; reason: string };

/**
 * Port for external game-database validation. Ticket 3.5 ships the IGDB
 * implementation; the MobyGames fallback (4.5) and multiquery batching (4.3)
 * plug in here without touching the pipeline.
 */
export abstract class GameCatalogResolver {
  abstract resolve(item: RecognizedItem): Promise<CatalogResolution>;
}
