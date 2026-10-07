import { Module } from '@nestjs/common';
import { CoversModule } from '../covers/covers.module';
import { EnrichmentModule } from '../enrichment/enrichment.module';
import { GameCatalogModule } from '../game-catalog/game-catalog.module';
import { GameIdentityModule } from '../games/game-identity.module';
import { PlatformsModule } from '../platforms/platforms.module';
import { ImportJobsController } from './import-jobs.controller';
import { ImportJobsService } from './import-jobs.service';
import { ImportUploadController } from './import-upload.controller';
import { ImportUploadService } from './import-upload.service';
import { PhotoImportPipelineService } from './photo-import-pipeline.service';
import { PhotoStorageService } from './photo-storage.service';
import { PhotoSweepService } from './photo-sweep.service';

@Module({
  imports: [
    GameCatalogModule,
    EnrichmentModule,
    CoversModule,
    PlatformsModule,
    GameIdentityModule,
  ],
  controllers: [ImportJobsController, ImportUploadController],
  providers: [
    ImportJobsService,
    ImportUploadService,
    PhotoStorageService,
    PhotoImportPipelineService,
    PhotoSweepService,
  ],
  exports: [ImportJobsService, PhotoStorageService, PhotoImportPipelineService],
})
export class ImportJobsModule {}
