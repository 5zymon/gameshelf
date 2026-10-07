import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChainedGameCatalogResolver } from './chained-game-catalog.resolver';
import {
  GAME_CATALOG_SOURCES,
  type GameCatalogSource,
  GameCatalogResolver,
} from './game-catalog.resolver';
import { FetchIgdbHttpClient, IgdbHttpClient } from './igdb-http.client';
import { IgdbHealthController } from './igdb-health.controller';
import { IgdbHealthService } from './igdb-health.service';
import { IgdbRateLimiter } from './igdb-rate-limiter';
import { IgdbGameCatalogResolver } from './igdb-game-catalog.resolver';
import { IgdbClient } from './igdb.client';
import {
  FetchMobygamesHttpClient,
  MobygamesHttpClient,
} from './mobygames-http.client';
import { MobygamesClient, isMobygamesConfigured } from './mobygames.client';
import { MobygamesGameCatalogResolver } from './mobygames-game-catalog.resolver';
import { MobygamesRateLimiter } from './mobygames-rate-limiter';

/**
 * The ordered validation chain. MobyGames is appended **only** when a key is
 * configured, so an unconfigured fallback is literally absent from the chain
 * (a title IGDB misses reports IGDB as the only source and never pauses).
 */
export function catalogSourceList(
  igdb: GameCatalogSource,
  mobygames: GameCatalogSource,
  mobygamesConfigured: boolean,
): GameCatalogSource[] {
  return mobygamesConfigured ? [igdb, mobygames] : [igdb];
}

/**
 * External game-catalog validation. Provides the IGDB HTTP seam, the
 * OAuth/search client, the optional MobyGames fallback client/limiter, and the
 * ordered anti-hallucination chain bound to the `GameCatalogResolver` port so
 * the import pipeline depends on the abstract class only:
 * `ChainedGameCatalogResolver` tries the registered `GAME_CATALOG_SOURCES` in
 * order (IGDB first, then MobyGames when `MOBYGAMES_API_KEY` is set), and a
 * title no source confirms is never saved as a `Game`. Ticket 4.1 adds one
 * central `IgdbRateLimiter` (4 req/s, 8 concurrent); ticket 4.5 adds a
 * MobyGames v2 client behind a 1 req/s / 720 req/h limiter that **waits** rather
 * than rejecting. `ConfigModule` is global, so both clients can read their
 * credentials without importing it.
 */
@Module({
  controllers: [IgdbHealthController],
  providers: [
    { provide: IgdbHttpClient, useClass: FetchIgdbHttpClient },
    { provide: IgdbRateLimiter, useFactory: () => new IgdbRateLimiter() },
    IgdbClient,
    IgdbHealthService,
    IgdbGameCatalogResolver,
    { provide: MobygamesHttpClient, useClass: FetchMobygamesHttpClient },
    {
      provide: MobygamesRateLimiter,
      useFactory: () => new MobygamesRateLimiter(),
    },
    MobygamesClient,
    MobygamesGameCatalogResolver,
    {
      provide: GAME_CATALOG_SOURCES,
      useFactory: (
        igdb: IgdbGameCatalogResolver,
        mobygames: MobygamesGameCatalogResolver,
        config: ConfigService,
      ): GameCatalogSource[] =>
        catalogSourceList(igdb, mobygames, isMobygamesConfigured(config)),
      inject: [
        IgdbGameCatalogResolver,
        MobygamesGameCatalogResolver,
        ConfigService,
      ],
    },
    { provide: GameCatalogResolver, useClass: ChainedGameCatalogResolver },
  ],
  exports: [
    GameCatalogResolver,
    IgdbClient,
    IgdbRateLimiter,
    MobygamesClient,
    MobygamesRateLimiter,
  ],
})
export class GameCatalogModule {}
