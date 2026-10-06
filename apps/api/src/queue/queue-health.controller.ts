import {
  Controller,
  Get,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { QueueHealth, QueueHealthService } from './queue-health.service';

@ApiTags('health')
@Controller('health')
export class QueueHealthController {
  private readonly logger = new Logger(QueueHealthController.name);

  constructor(private readonly queueHealth: QueueHealthService) {}

  @Public()
  @Get('queue')
  @ApiOperation({ summary: 'Photo-import queue and worker health' })
  @ApiOkResponse({ description: 'Queue job counts and worker readiness' })
  async getQueueHealth(): Promise<QueueHealth> {
    try {
      return await this.queueHealth.getHealth();
    } catch (error) {
      // The endpoint is unauthenticated: log the cause server-side and return
      // a fixed message so internals (host names, stack detail) are not leaked.
      this.logger.error(
        'Queue health check failed',
        error instanceof Error ? error.stack : String(error),
      );
      throw new ServiceUnavailableException('Queue health check failed');
    }
  }
}
