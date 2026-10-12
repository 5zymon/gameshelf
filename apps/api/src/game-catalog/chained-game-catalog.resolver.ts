import { Inject, Injectable } from '@nestjs/common';
import type { RecognizedItem } from '../settings/vision/vision-provider';
import {
  type CatalogCandidate,
  type CatalogResolution,
  type CatalogSearchResult,
  GAME_CATALOG_SOURCES,
  type GameCatalogSource,
  GameCatalogResolver,
  type TiedCatalogCandidate,
} from './game-catalog.resolver';

interface SourceMiss {
  label: string;
  reason: string;
  /** Tied candidates carried by this source's miss, if it was a tie. */
  tiedCandidates?: readonly TiedCatalogCandidate[];
}

/** Aggregated reason emitted only when every source returned `unrecognized`. */
export function noCatalogSourceMatchedReason(
  misses: readonly SourceMiss[],
): string {
  if (misses.length === 0) {
    return 'No game catalog source is configured';
  }
  const tied = misses.flatMap((miss) => miss.tiedCandidates ?? []);
  if (tied.length === 0) {
    return `No game matched the title in any source — ${misses
      .map((miss) => `${miss.label}: ${miss.reason}`)
      .join('; ')}`;
  }
  const names = tied.map((entry) => entry.candidate.title);
  const others = misses.filter((miss) => !miss.tiedCandidates?.length);
  return (
    `Multiple candidates matched equally well (${names.join(', ')}) — choose one` +
    (others.length > 0
      ? ` — ${others.map((miss) => `${miss.label}: ${miss.reason}`).join('; ')}`
      : '')
  );
}

/**
 * Ordered anti-hallucination chain. Tries each source in registration order:
 * the first `matched` wins; the first `transient` stops the chain and is
 * returned (retryable — do not mark a title unrecognized while a source is only
 * throttled/down); only if *every* source returns `unrecognized` is the title
 * flagged. A title no source confirms is therefore never returned as a
 * candidate and never saved as a `Game`.
 */
@Injectable()
export class ChainedGameCatalogResolver extends GameCatalogResolver {
  constructor(
    @Inject(GAME_CATALOG_SOURCES)
    private readonly sources: readonly GameCatalogSource[],
  ) {
    super();
  }

  override async resolve(item: RecognizedItem): Promise<CatalogResolution> {
    const misses: SourceMiss[] = [];
    for (const source of this.sources) {
      const resolution = await source.resolve(item);
      if (resolution.kind === 'matched') {
        return resolution;
      }
      if (resolution.kind === 'transient') {
        return resolution;
      }
      if (resolution.kind === 'config_error') {
        return resolution;
      }
      misses.push({
        label: source.label,
        reason: resolution.reason,
        tiedCandidates: resolution.tiedCandidates,
      });
    }
    const tied = misses.flatMap((miss) => miss.tiedCandidates ?? []);
    return {
      kind: 'unrecognized',
      reason: noCatalogSourceMatchedReason(misses),
      ...(tied.length > 0 && { tiedCandidates: tied }),
    };
  }

  // resolveBatch intentionally NOT overridden: inherited default calls this.resolve per item.

  /**
   * Ordered title search for manual add. IGDB-first: a later source is only
   * queried when every earlier source returned no candidates (rate-limit
   * friendly, mirrors the validation chain). A later failure keeps whatever
   * candidates an earlier source already produced.
   */
  override async search(query: string): Promise<CatalogSearchResult> {
    const candidates: CatalogCandidate[] = [];
    for (const source of this.sources) {
      const result = await source.search(query);
      if (result.kind === 'matches') {
        candidates.push(...result.candidates);
        if (candidates.length > 0) return { kind: 'matches', candidates }; // first hit wins
      } else if (candidates.length > 0) {
        return { kind: 'matches', candidates }; // later source failed; keep results
      } else {
        return result; // transient/config_error from the first source
      }
    }
    return { kind: 'matches', candidates };
  }
}
