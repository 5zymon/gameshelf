import { Global, Module } from '@nestjs/common';
import { ImportJobsModule } from '../import-jobs/import-jobs.module';
import { PhotoImportHandler } from './photo-import.handler';
import { PhotoImportQueue } from './photo-import.queue';
import { PhotoImportWorker } from './photo-import.worker';
import { QueueControlService } from './queue-control.service';
import { QueueHealthController } from './queue-health.controller';
import { QueueHealthService } from './queue-health.service';
import {
  PHOTO_IMPORT_QUEUE_OPTIONS,
  photoImportQueueOptions,
} from './queue.options';

/**
 * Photo-import queue infrastructure (ADR-005). Global so `ImportJobsService`
 * can inject `PhotoImportQueue`/`QueueControlService` without importing this
 * module everywhere (no cycle: `ImportJobsModule` never imports `QueueModule`).
 * `ImportJobsModule` supplies the pipeline the handler delegates to. The global
 * control surface (`QueueControlService`, ticket 3.10) pauses/resumes the queue
 * on a configuration error.
 */
@Global()
@Module({
  imports: [ImportJobsModule],
  controllers: [QueueHealthController],
  providers: [
    {
      provide: PHOTO_IMPORT_QUEUE_OPTIONS,
      useValue: photoImportQueueOptions(),
    },
    PhotoImportQueue,
    PhotoImportHandler,
    PhotoImportWorker,
    QueueHealthService,
    QueueControlService,
  ],
  exports: [PhotoImportQueue, QueueControlService],
})
export class QueueModule {}
