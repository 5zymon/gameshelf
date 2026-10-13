import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CoverCacheService } from './cover-cache.service';
import {
  COVER_PREVIEW_HOSTS_ENV,
  COVER_RETRY_BATCH_SIZE,
  COVER_RETRY_SWEEP_MAX_PAGES,
  isAllowedCoverHost,
} from './covers.options';

/** Summary of one `covers:redownload` run. */
export interface CoverRecoveryResult {
  /** Games that carry a stored external link (the recoverable set). */
  total: number;
  /** Covers re-downloaded during this run. */
  downloaded: number;
  /** Games whose local file was already present (thumbnail ensured). */
  alreadyPresent: number;
  /** Games whose source download failed (left for a later retry). */
  failed: number;
  /**
   * Unrecoverable games: either missing a cover with no stored external link,
   * or carrying a `sourceCoverUrl` whose host is not on the cover allowlist, so
   * no download is attempted and the row can never be repaired.
   */
  noSource: number;
}

/**
 * Repairs the local cover cache from stored game-database links. Two entry
 * points share the same mechanics: the documented `covers:redownload` command
 * walks every game with a `sourceCoverUrl`, and the background sweep retries the
 * `coverUrl: null` placeholders left by a failed import.
 *
 * `redownloadMissing` is CLI-only and lets database errors propagate so the
 * command exits non-zero instead of reporting a hollow success; `retryMissing`
 * isolates per-game download failures. Both classify a source link whose host is
 * not allowlisted as unrecoverable (`noSource`) rather than a failed download.
 */
@Injectable()
export class CoverRecoveryService {
  private readonly logger = new Logger(CoverRecoveryService.name);

  /**
   * Where the next bounded background sweep resumes. `null` means "from the
   * start". Rotating the start across sweeps means a permanently-failing row
   * cannot starve later rows, while each sweep stays bounded.
   */
  private retryCursorId: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CoverCacheService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Re-downloads every missing cover from its stored `sourceCoverUrl` (used by
   * `covers:redownload`, e.g. after the cover directory is wiped). Games whose
   * file is already present are counted and their thumbnail ensured.
   */
  async redownloadMissing(
    batchSize = COVER_RETRY_BATCH_SIZE,
  ): Promise<CoverRecoveryResult> {
    const result: CoverRecoveryResult = {
      total: 0,
      downloaded: 0,
      alreadyPresent: 0,
      failed: 0,
      noSource: 0,
    };
    const pageSize = batchSize > 0 ? batchSize : COVER_RETRY_BATCH_SIZE;
    // A database-wide read failure here is fatal: propagate it so the CLI exits
    // non-zero rather than reporting a hollow `failed=0` after restoring nothing
    // (the wiped-directory/restored-dump case this command exists for).
    result.noSource = await this.prisma.game.count({
      where: { coverUrl: null, sourceCoverUrl: null },
    });
    for (let skip = 0; ; skip += pageSize) {
      const games = await this.prisma.game.findMany({
        where: { sourceCoverUrl: { not: null } },
        select: { id: true, coverUrl: true, sourceCoverUrl: true },
        orderBy: { id: 'asc' },
        skip,
        take: pageSize,
      });
      if (games.length === 0) {
        break;
      }
      result.total += games.length;
      for (const game of games) {
        // One game's failure (download OR the row update) must never abort the
        // run: count it and keep restoring the rest, so the command still
        // repopulates every recoverable cover it can.
        try {
          const restored = await this.restoreOne(game);
          if (restored === 'present') {
            result.alreadyPresent += 1;
          } else if (restored === 'downloaded') {
            result.downloaded += 1;
          } else if (restored === 'unrecoverable') {
            result.noSource += 1;
          } else {
            result.failed += 1;
          }
        } catch (error) {
          result.failed += 1;
          this.logger.warn(
            `Failed to restore cover for game ${game.id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    }
    return result;
  }

  /**
   * Refreshes one game's cover. Returns `true` when a cover is present (already
   * or just restored) and `false` when the download failed, so the sweep can
   * count retries that still need another attempt. An unrecoverable source link
   * (no link, or a host off the allowlist) is treated as resolved rather than a
   * failure, so it is never counted as one: the row is still re-selected
   * cheaply on each sweep, but no download is attempted for it.
   */
  async refreshGame(gameId: string): Promise<boolean> {
    try {
      const game = await this.prisma.game.findUnique({
        where: { id: gameId },
        select: { id: true, coverUrl: true, sourceCoverUrl: true },
      });
      if (game === null) {
        return true;
      }
      if (game.sourceCoverUrl === null) {
        return true;
      }
      return (await this.restoreOne(game)) !== 'failed';
    } catch (error) {
      this.logger.warn(
        `Failed to refresh cover for game ${gameId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  /**
   * Retries the `coverUrl: null` placeholders, returning the number of covers
   * actually restored. Bounded to `COVER_RETRY_BATCH_SIZE`-sized pages and up to
   * `COVER_RETRY_SWEEP_MAX_PAGES` pages per call, and the start position
   * **rotates** across calls (cursor on `id`), so permanently-failing low-id
   * rows never starve higher-id ones.
   */
  async retryMissing(batchSize = COVER_RETRY_BATCH_SIZE): Promise<number> {
    const pageSize = batchSize > 0 ? batchSize : COVER_RETRY_BATCH_SIZE;
    let recovered = 0;
    let cursor = this.retryCursorId;
    let pages = 0;
    while (pages < COVER_RETRY_SWEEP_MAX_PAGES) {
      const games = await this.prisma.game.findMany({
        where: {
          coverUrl: null,
          sourceCoverUrl: { not: null },
          ...(cursor !== null && { id: { gt: cursor } }),
        },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: pageSize,
      });
      if (games.length === 0) {
        // The pending set is exhausted for this rotation: wrap to the start.
        cursor = null;
        break;
      }
      for (const game of games) {
        if (await this.refreshGame(game.id)) {
          recovered += 1;
        }
      }
      pages += 1;
      const last = games[games.length - 1];
      if (last === undefined) {
        break;
      }
      cursor = last.id;
      if (games.length < pageSize) {
        cursor = null;
        break;
      }
    }
    this.retryCursorId = cursor;
    return recovered;
  }

  private async restoreOne(game: {
    id: string;
    coverUrl: string | null;
    sourceCoverUrl: string | null;
  }): Promise<'present' | 'downloaded' | 'failed' | 'unrecoverable'> {
    if (game.sourceCoverUrl === null) {
      return 'failed';
    }
    // A source link the download path would reject outright (off-allowlist,
    // non-HTTP(S), or unparseable) is unrecoverable, not a transient failure.
    // `cacheFromUrl` enforces the same allowlist, so this only moves the
    // classification earlier; it never changes what can be downloaded.
    if (!this.isAllowedSource(game.sourceCoverUrl)) {
      return 'unrecoverable';
    }
    const file =
      game.coverUrl === null
        ? null
        : this.cache.fileFromServedUrl(game.coverUrl);
    if (file !== null && (await this.cache.has(file))) {
      await this.cache.ensureThumbnail(file);
      return 'present';
    }
    const served = await this.cache.cacheFromUrl(game.sourceCoverUrl);
    if (served === null) {
      return 'failed';
    }
    const restored = this.cache.fileFromServedUrl(served);
    if (restored !== null) {
      await this.cache.ensureThumbnail(restored);
    }
    await this.prisma.game.update({
      where: { id: game.id },
      data: { coverUrl: served },
    });
    return 'downloaded';
  }

  /**
   * True when `url` is an absolute HTTP(S) URL whose host is on the cover
   * allowlist — i.e. exactly what `CoverCacheService.cacheFromUrl` accepts.
   */
  private isAllowedSource(url: string): boolean {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    return isAllowedCoverHost(
      parsed.hostname,
      this.config.get<string>(COVER_PREVIEW_HOSTS_ENV),
    );
  }
}
