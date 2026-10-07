import { Module } from '@nestjs/common';
import { CoverCacheService } from './cover-cache.service';
import { CoverHttpClient, FetchCoverHttpClient } from './cover-http.client';
import { CoversController } from './covers.controller';

/**
 * Local cover cache: downloads a candidate's external `coverUrl` once and
 * serves it from the application's own origin. `CoverCacheService` is exported
 * for the enrichment mapping used by imports (and, later, re-enrichment).
 */
@Module({
  controllers: [CoversController],
  providers: [
    CoverCacheService,
    { provide: CoverHttpClient, useClass: FetchCoverHttpClient },
  ],
  exports: [CoverCacheService],
})
export class CoversModule {}
