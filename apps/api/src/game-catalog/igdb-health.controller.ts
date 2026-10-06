import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { type IgdbHealth } from './igdb.client';
import { IgdbHealthService } from './igdb-health.service';

@ApiTags('health')
@Controller('health')
export class IgdbHealthController {
  constructor(private readonly igdbHealth: IgdbHealthService) {}

  @Public()
  @Get('igdb')
  @ApiOperation({ summary: 'IGDB connectivity and OAuth token status' })
  @ApiOkResponse({
    description: 'Connectivity status; never fails the request',
  })
  async getIgdbHealth(): Promise<IgdbHealth> {
    try {
      return await this.igdbHealth.check();
    } catch {
      return {
        status: 'error',
        token: 'error',
        message: 'IGDB status check failed',
      };
    }
  }
}
