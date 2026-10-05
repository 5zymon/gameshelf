import { Module } from '@nestjs/common';
import { ImportJobsController } from './import-jobs.controller';
import { ImportJobsService } from './import-jobs.service';

@Module({
  controllers: [ImportJobsController],
  providers: [ImportJobsService],
})
export class ImportJobsModule {}
