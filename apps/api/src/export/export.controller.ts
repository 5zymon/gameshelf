import { Controller, Get, Query, Res } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ExportCsvQueryDto } from './dto/export-csv-query.dto';
import { exportFilename, ExportService } from './export.service';

/** Catalog export. Auth is the global `SessionGuard` (never `@Public()`). */
@ApiTags('export')
@Controller('export')
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  @Get('csv')
  @ApiOperation({
    summary:
      'Download the catalog as a CSV file: whole catalog or one platform',
  })
  @ApiProduces('text/csv')
  @ApiOkResponse({
    description:
      'CSV attachment named gameshelf-YYYY-MM-DD.csv: a header row and one row per game',
  })
  @ApiBadRequestResponse({
    description: 'Malformed or repeated platformId, or an unknown query param',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiNotFoundResponse({ description: 'No platform with that id' })
  async catalogCsv(
    @Query() query: ExportCsvQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const body = await this.exportService.catalogCsv(query.platformId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${exportFilename(new Date())}"`,
    );
    res.setHeader('Cache-Control', 'no-store');
    return body;
  }
}
