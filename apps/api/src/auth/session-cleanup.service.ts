import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { SESSION_CLEANUP_INTERVAL_MS } from './auth.config';
import { SessionsService } from './sessions.service';

@Injectable()
export class SessionCleanupService {
  private readonly logger = new Logger(SessionCleanupService.name);

  constructor(private readonly sessions: SessionsService) {}

  @Interval(SESSION_CLEANUP_INTERVAL_MS)
  async cleanup(): Promise<void> {
    try {
      const removed = await this.sessions.cleanupExpired();
      if (removed > 0) {
        this.logger.log(`Removed ${String(removed)} expired session(s)`);
      }
    } catch (error) {
      this.logger.error(
        'Expired-session cleanup failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
