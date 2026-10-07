import { Module } from '@nestjs/common';
import { CoversModule } from '../covers/covers.module';
import { GameEnrichmentService } from './game-enrichment.service';

/**
 * Candidate→`Game` enrichment. Imports the cover cache so a saved game's
 * `coverUrl` is a same-origin path. Exported for the import pipeline now and
 * for re-enrichment later.
 */
@Module({
  imports: [CoversModule],
  providers: [GameEnrichmentService],
  exports: [GameEnrichmentService],
})
export class EnrichmentModule {}
