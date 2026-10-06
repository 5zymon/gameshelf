import { Module } from '@nestjs/common';
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

/**
 * External game-catalog validation. Provides the IGDB HTTP seam, the
 * OAuth/search client, and the ordered anti-hallucination chain bound to the
 * `GameCatalogResolver` port so the import pipeline depends on the abstract
 * class only: `ChainedGameCatalogResolver` tries the registered
 * `GAME_CATALOG_SOURCES` in order (IGDB today; ticket 4.5 appends a MobyGames
 * source with no pipeline change), and a title no source confirms is never
 * saved as a `Game`. Ticket 4.1 adds one central `IgdbRateLimiter` (4 req/s, 8
 * concurrent) shared by every IGDB call, plus an unauthenticated
 * `GET /health/igdb` probe. `ConfigModule` is global, so `IgdbClient` can read
 * the IGDB credentials without importing it.
 */
@Module({
  controllers: [IgdbHealthController],
  providers: [
    { provide: IgdbHttpClient, useClass: FetchIgdbHttpClient },
    { provide: IgdbRateLimiter, useFactory: () => new IgdbRateLimiter() },
    IgdbClient,
    IgdbHealthService,
    IgdbGameCatalogResolver,
    {
      provide: GAME_CATALOG_SOURCES,
      useFactory: (igdb: IgdbGameCatalogResolver): GameCatalogSource[] => [
        igdb,
      ],
      inject: [IgdbGameCatalogResolver],
    },
    { provide: GameCatalogResolver, useClass: ChainedGameCatalogResolver },
  ],
  exports: [GameCatalogResolver, IgdbClient, IgdbRateLimiter],
})
export class GameCatalogModule {}
