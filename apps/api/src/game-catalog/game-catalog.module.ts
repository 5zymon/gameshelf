import { Module } from '@nestjs/common';
import { GameCatalogResolver } from './game-catalog.resolver';
import { FetchIgdbHttpClient, IgdbHttpClient } from './igdb-http.client';
import { IgdbGameCatalogResolver } from './igdb-game-catalog.resolver';
import { IgdbClient } from './igdb.client';

/**
 * External game-catalog validation (ticket 3.5). Provides the IGDB HTTP seam,
 * the OAuth/search client, and the resolver bound to the `GameCatalogResolver`
 * port so the import pipeline depends on the abstract class only. `ConfigModule`
 * is global, so `IgdbClient` can read the IGDB credentials without importing it.
 */
@Module({
  providers: [
    { provide: IgdbHttpClient, useClass: FetchIgdbHttpClient },
    IgdbClient,
    { provide: GameCatalogResolver, useClass: IgdbGameCatalogResolver },
  ],
  exports: [GameCatalogResolver, IgdbClient],
})
export class GameCatalogModule {}
