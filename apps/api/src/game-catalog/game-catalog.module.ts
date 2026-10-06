import { Module } from '@nestjs/common';
import { GameCatalogResolver } from './game-catalog.resolver';
import { FetchIgdbHttpClient, IgdbHttpClient } from './igdb-http.client';
import { IgdbHealthController } from './igdb-health.controller';
import { IgdbHealthService } from './igdb-health.service';
import { IgdbRateLimiter } from './igdb-rate-limiter';
import { IgdbGameCatalogResolver } from './igdb-game-catalog.resolver';
import { IgdbClient } from './igdb.client';

/**
 * External game-catalog validation (ticket 3.5). Provides the IGDB HTTP seam,
 * the OAuth/search client, and the resolver bound to the `GameCatalogResolver`
 * port so the import pipeline depends on the abstract class only. Ticket 4.1
 * adds one central `IgdbRateLimiter` (4 req/s, 8 concurrent) shared by every
 * IGDB call, plus an unauthenticated `GET /health/igdb` probe. `ConfigModule`
 * is global, so `IgdbClient` can read the IGDB credentials without importing it.
 */
@Module({
  controllers: [IgdbHealthController],
  providers: [
    { provide: IgdbHttpClient, useClass: FetchIgdbHttpClient },
    { provide: IgdbRateLimiter, useFactory: () => new IgdbRateLimiter() },
    IgdbClient,
    IgdbHealthService,
    { provide: GameCatalogResolver, useClass: IgdbGameCatalogResolver },
  ],
  exports: [GameCatalogResolver, IgdbClient, IgdbRateLimiter],
})
export class GameCatalogModule {}
