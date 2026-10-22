import { Controller, Get, Query, Res } from '@nestjs/common';
import {
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
  @ApiOperation({ summary: 'Download the whole catalog as a CSV file' })
  @ApiProduces('text/csv')
  @ApiOkResponse({
    description:
      'CSV attachment named gameshelf-YYYY-MM-DD.csv: a header row and one row per game',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  async catalogCsv(
    @Query() _query: ExportCsvQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const body = await this.exportService.catalogCsv();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${exportFilename(new Date())}"`,
    );
    res.setHeader('Cache-Control', 'no-store');
    return body;
  }
}
