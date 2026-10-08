import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IGDB_CLIENT_ID_ENV,
  IGDB_CLIENT_SECRET_ENV,
} from '../game-catalog/igdb.client';
import { MOBYGAMES_API_KEY_ENV } from '../game-catalog/mobygames.options';
import { PrismaService } from '../prisma/prisma.service';
import {
  GameDatabaseStatusModel,
  type GameDatabaseId,
} from './dto/game-database-status.model';

const SINGLETON_ID = 1;

/**
 * Reports whether each game database is usable, without any network call.
 *
 * `missing` when the provider's env key(s) are absent; `rejected` when the
 * durable `import_queue_state` singleton is paused with `source === id` (the
 * exact place the import pipeline records a provider that rejected the
 * credentials, reason included); otherwise `configured`.
 *
 * Deliberately no per-render probe: a live MobyGames request would go through
 * `MobygamesRateLimiter`, which waits when saturated and could block the
 * settings render. A rejected key therefore surfaces here only after an import
 * has failed with a config error.
 */
@Injectable()
export class GameDatabaseStatusService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async list(): Promise<GameDatabaseStatusModel[]> {
    const row = await this.prisma.importQueueState.findUnique({
      where: { id: SINGLETON_ID },
    });
    const rejectedSource = row?.paused === true ? row.source : null;
    const reason = row?.paused === true ? (row.reason ?? null) : null;
    return [
      this.entry(
        'igdb',
        'IGDB',
        this.hasAll(IGDB_CLIENT_ID_ENV, IGDB_CLIENT_SECRET_ENV),
        rejectedSource,
        reason,
      ),
      this.entry(
        'mobygames',
        'MobyGames',
        this.has(MOBYGAMES_API_KEY_ENV),
        rejectedSource,
        reason,
      ),
    ];
  }

  private entry(
    id: GameDatabaseId,
    label: string,
    configured: boolean,
    rejectedSource: string | null,
    reason: string | null,
  ): GameDatabaseStatusModel {
    if (!configured) return { id, label, state: 'missing', message: null };
    if (rejectedSource === id) {
      return { id, label, state: 'rejected', message: reason };
    }
    return { id, label, state: 'configured', message: null };
  }

  private has(key: string): boolean {
    const value = this.config.get<string>(key)?.trim();
    return value !== undefined && value !== '';
  }

  private hasAll(...keys: string[]): boolean {
    return keys.every((key) => this.has(key));
  }
}
