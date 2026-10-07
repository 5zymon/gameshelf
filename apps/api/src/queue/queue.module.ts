import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ImportJobsModule } from '../import-jobs/import-jobs.module';
import { PhotoImportHandler } from './photo-import.handler';
import { PhotoImportProcessor } from './photo-import.processor';
import { PHOTO_IMPORT_QUEUE } from './queue.constants';
import { photoImportDefaultJobOptions } from './queue.options';
import { QueueControlService } from './queue-control.service';
import { QueueHealthController } from './queue-health.controller';
import { QueueHealthService } from './queue-health.service';

/**
 * Photo-import queue infrastructure (ADR-002). Global so tickets 3.2/3.5 can
 * `@InjectQueue(PHOTO_IMPORT_QUEUE)` without importing this module everywhere.
 * Exporting BullModule re-exports the registered queue. `ImportJobsModule`
 * supplies the pipeline the handler delegates to (no cycle: ImportJobsModule
 * never imports QueueModule). The global control surface (`QueueControlService`,
 * ticket 3.10) pauses/resumes the queue on a configuration error.
 */
@Global()
@Module({
  imports: [
    BullModule.registerQueue({
      name: PHOTO_IMPORT_QUEUE,
      defaultJobOptions: photoImportDefaultJobOptions(),
    }),
    ImportJobsModule,
  ],
  controllers: [QueueHealthController],
  providers: [
    PhotoImportHandler,
    PhotoImportProcessor,
    QueueHealthService,
    QueueControlService,
  ],
  exports: [BullModule, QueueControlService],
})
export class QueueModule {}
