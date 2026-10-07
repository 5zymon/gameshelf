import { Module } from '@nestjs/common';
import { CoverCacheService } from './cover-cache.service';
import { CoverHttpClient, FetchCoverHttpClient } from './cover-http.client';
import { CoverMaintenanceService } from './cover-maintenance.service';
import { CoverPreviewService } from './cover-preview.service';
import { CoverRecoveryService } from './cover-recovery.service';
import { CoverSweepService } from './cover-sweep.service';
import { CoversController } from './covers.controller';

/**
 * Local cover cache: downloads a candidate's external `coverUrl` once, stores it
 * locally, generates catalog thumbnails with `sharp`, and serves both from the
 * application's own origin. Background retry is the scheduled `CoverSweepService`
 * (ADR-002: no second BullMQ queue); `CoverRecoveryService` powers the
 * documented `covers:redownload` command.
 */
@Module({
  controllers: [CoversController],
  providers: [
    CoverCacheService,
    { provide: CoverHttpClient, useClass: FetchCoverHttpClient },
    CoverPreviewService,
    CoverMaintenanceService,
    CoverRecoveryService,
    CoverSweepService,
  ],
  exports: [
    CoverCacheService,
    CoverPreviewService,
    CoverMaintenanceService,
    CoverRecoveryService,
  ],
})
export class CoversModule {}
