import { Injectable } from '@nestjs/common';
import { IgdbClient } from '../game-catalog/igdb.client';
import { findPlatformMatch, normalizePlatformName } from './platform-match';
import {
  PlatformsService,
  type CanonicalPlatformInput,
} from './platforms.service';

/** Outcome counts of one platform sync run. */
export interface PlatformSyncResult {
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
}

/** Trims an optional IGDB string, mapping absent/blank to `null`. */
function trimmedOrNull(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Fetches the whole IGDB platform list once and reconciles it with the local
 * `platforms` table (ticket 4.2). This is the lazy-population / refresh path:
 * a platform unknown locally is created here, never on a per-game import.
 *
 * The run is idempotent — re-running it updates only rows whose canonical
 * fields changed and reports them as `unchanged` otherwise — and no `name` or
 * `slug` is ever rewritten, so custom names and stable slugs survive.
 */
@Injectable()
export class PlatformsSyncService {
  constructor(
    private readonly igdb: IgdbClient,
    private readonly platforms: PlatformsService,
  ) {}

  async sync(): Promise<PlatformSyncResult> {
    // Exactly one upstream request, then one local read.
    const fetched = await this.igdb.fetchPlatforms();
    const available = await this.platforms.listMatchCandidates();

    // Deterministic order: normalized name, then IGDB id.
    const ordered = [...fetched].sort((a, b) => {
      const aName = normalizePlatformName(a.name);
      const bName = normalizePlatformName(b.name);
      if (aName < bName) return -1;
      if (aName > bName) return 1;
      return a.id - b.id;
    });

    let created = 0;
    let updated = 0;
    let unchanged = 0;
    for (const platform of ordered) {
      const name = platform.name.trim();
      if (normalizePlatformName(name) === '') {
        continue;
      }
      const abbreviation = trimmedOrNull(platform.abbreviation);
      const alternativeName = trimmedOrNull(platform.alternative_name);
      const platformFamily =
        typeof platform.platform_family === 'number'
          ? platform.platform_family
          : null;
      const input: CanonicalPlatformInput = {
        name,
        abbreviation,
        alternativeName,
        platformFamily,
        igdbId: platform.id,
      };

      const match = findPlatformMatch(available, [
        name,
        abbreviation,
        alternativeName,
      ]);
      if (match) {
        const changed = await this.platforms.updateCanonical(match.id, input);
        if (changed) {
          updated += 1;
        } else {
          unchanged += 1;
        }
      } else {
        const row = await this.platforms.createCanonical(input);
        available.push(row);
        created += 1;
      }
    }

    return {
      fetched: fetched.length,
      created,
      updated,
      unchanged,
    };
  }
}
