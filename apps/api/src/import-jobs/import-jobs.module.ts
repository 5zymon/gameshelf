import { Module } from '@nestjs/common';
import { GameCatalogModule } from '../game-catalog/game-catalog.module';
import { ImportJobsController } from './import-jobs.controller';
import { ImportJobsService } from './import-jobs.service';
import { ImportUploadController } from './import-upload.controller';
import { ImportUploadService } from './import-upload.service';
import { PhotoImportPipelineService } from './photo-import-pipeline.service';
import { PhotoStorageService } from './photo-storage.service';
import { PhotoSweepService } from './photo-sweep.service';

@Module({
  imports: [GameCatalogModule],
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
