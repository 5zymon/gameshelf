import { Module } from '@nestjs/common';
import { ImportJobsController } from './import-jobs.controller';
import { ImportJobsService } from './import-jobs.service';
import { ImportUploadController } from './import-upload.controller';
import { ImportUploadService } from './import-upload.service';
import { LlmConfigService } from './llm-config.service';
import { PhotoStorageService } from './photo-storage.service';

@Module({
  controllers: [ImportJobsController, ImportUploadController],
  providers: [
    ImportJobsService,
    ImportUploadService,
    LlmConfigService,
    PhotoStorageService,
  ],
})
export class ImportJobsModule {}
