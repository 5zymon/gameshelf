import { Module } from '@nestjs/common';
import { GameCatalogModule } from '../game-catalog/game-catalog.module';
import { PlatformsController } from './platforms.controller';
import { PlatformsService } from './platforms.service';
import { PlatformsSyncService } from './platforms-sync.service';

@Module({
  imports: [GameCatalogModule],
  controllers: [PlatformsController],
  providers: [PlatformsService, PlatformsSyncService],
  exports: [PlatformsService, PlatformsSyncService],
})
export class PlatformsModule {}
