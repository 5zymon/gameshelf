import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { CoverRecoveryService } from './cover-recovery.service';
import { COVER_RETRY_SWEEP_INTERVAL_MS } from './covers.options';

/**
 * Background backstop for failed cover downloads (ADR-002: no second queue).
 * A scheduled sweep retries the games left with a `coverUrl: null` placeholder
 * and a stored `sourceCoverUrl`, so a transient download failure heals without
 * any user action. The CLI `covers:redownload` covers the wiped-directory case.
 */
@Injectable()
export class CoverSweepService {
  private readonly logger = new Logger(CoverSweepService.name);

  constructor(private readonly recovery: CoverRecoveryService) {}

  /** Exposed without the decorator side-effect so tests can call it directly. */
  @Interval(COVER_RETRY_SWEEP_INTERVAL_MS)
  async sweep(): Promise<void> {
    try {
      const recovered = await this.recovery.retryMissing();
      if (recovered > 0) {
        this.logger.log(`Cover sweep: restored ${String(recovered)} cover(s)`);
      }
    } catch (error) {
      this.logger.error(
        'Cover sweep failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
