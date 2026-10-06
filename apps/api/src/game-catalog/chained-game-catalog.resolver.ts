import { Inject, Injectable } from '@nestjs/common';
import type { RecognizedItem } from '../settings/vision/vision-provider';
import {
  type CatalogResolution,
  GAME_CATALOG_SOURCES,
  type GameCatalogSource,
  GameCatalogResolver,
} from './game-catalog.resolver';

interface SourceMiss {
  label: string;
  reason: string;
}

/** Aggregated reason emitted only when every source returned `unrecognized`. */
export function noCatalogSourceMatchedReason(
  misses: readonly SourceMiss[],
): string {
  if (misses.length === 0) {
    return 'No game catalog source is configured';
  }
  return `No game matched the title in any source — ${misses
    .map((miss) => `${miss.label}: ${miss.reason}`)
    .join('; ')}`;
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
      misses.push({ label: source.label, reason: resolution.reason });
    }
    return {
      kind: 'unrecognized',
      reason: noCatalogSourceMatchedReason(misses),
    };
  }

  // resolveBatch intentionally NOT overridden: inherited default calls this.resolve per item.
}
