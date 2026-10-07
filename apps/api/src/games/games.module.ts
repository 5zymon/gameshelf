import { Module } from '@nestjs/common';
import { CoversModule } from '../covers/covers.module';
import { EnrichmentModule } from '../enrichment/enrichment.module';
import { GameCatalogModule } from '../game-catalog/game-catalog.module';
import { GamesController } from './games.controller';
import { GamesService } from './games.service';

@Module({
  imports: [GameCatalogModule, EnrichmentModule, CoversModule],
  controllers: [GamesController],
  providers: [GamesService],
})
export class GamesModule {}
