import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StatsQueryDto } from './dto/stats-query.dto';
import { StatsResponseModel } from './dto/stats-response.model';
import { StatsService } from './stats.service';

@ApiTags('stats')
@Controller('stats')
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get()
  @ApiOperation({ summary: 'Collection statistics' })
  @ApiOkResponse({ type: StatsResponseModel })
  getStats(@Query() _query: StatsQueryDto): Promise<StatsResponseModel> {
    return this.stats.getStats();
  }
}
