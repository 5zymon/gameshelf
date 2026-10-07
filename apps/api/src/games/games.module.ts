import { Module } from '@nestjs/common';
import { CoversModule } from '../covers/covers.module';
import { EnrichmentModule } from '../enrichment/enrichment.module';
import { GameCatalogModule } from '../game-catalog/game-catalog.module';
import { GamesController } from './games.controller';
import { GameIdentityModule } from './game-identity.module';
import { GamesService } from './games.service';

@Module({
  imports: [
    GameCatalogModule,
    EnrichmentModule,
    CoversModule,
    GameIdentityModule,
  ],
  controllers: [GamesController],
  providers: [GamesService],
})
export class GamesModule {}
