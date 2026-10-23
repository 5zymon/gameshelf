import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsUUID } from 'class-validator';

import { lowercaseId } from '../../common/lowercase-id';
import { UUID_V7_EXAMPLE } from '../../common/uuid-v7';

/**
 * Query of `GET /export/csv`. The global `ValidationPipe` only runs for a
 * bound DTO, so any param not declared here fails with 400.
 */
export class ExportCsvQueryDto {
  /** Optional: export only this platform's games. */
  @ApiPropertyOptional({ format: 'uuid', example: UUID_V7_EXAMPLE })
  @IsOptional()
  @Transform(lowercaseId)
  @IsUUID('7')
  platformId?: string;
}
