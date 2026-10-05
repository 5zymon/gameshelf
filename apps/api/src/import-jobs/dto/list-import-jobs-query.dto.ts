import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export const IMPORT_JOB_STATUSES = [
  'queued',
  'processing',
  'done',
  'needs_attention',
  'failed',
  'dismissed',
] as const;
export type ImportJobStatus = (typeof IMPORT_JOB_STATUSES)[number];

export class ListImportJobsQueryDto {
  @ApiPropertyOptional({
    description: 'Page number (1-based)',
    default: 1,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    description: 'Page size (default 20, max 100)',
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Filter by job status',
    enum: IMPORT_JOB_STATUSES,
    example: 'needs_attention',
  })
  @IsOptional()
  @IsIn([...IMPORT_JOB_STATUSES])
  status?: ImportJobStatus;
}
