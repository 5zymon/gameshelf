import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IMPORT_JOB_STATUSES } from './list-import-jobs-query.dto';

/** One row of `import_jobs` — a single import run (one uploaded photo). */
export class ImportJobModel {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({
    enum: IMPORT_JOB_STATUSES,
    example: 'needs_attention',
    description:
      'queued -> processing -> done | needs_attention | failed; user may dismiss a needs_attention/failed job',
  })
  status!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Item count the user declared when uploading (if any)',
    example: 12,
  })
  declaredCount!: number | null;

  @ApiProperty({ example: 11 })
  recognizedCount!: number;

  @ApiProperty({ example: 9 })
  importedCount!: number;

  @ApiProperty({
    example: 2,
    description:
      'Flagged items: unrecognized + unreadable (ADR-002 result contract)',
  })
  unrecognizedCount!: number;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Reason shown to the UI when status is failed',
    example: 'LLM request timed out',
  })
  errorMessage!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  completedAt!: Date | null;
}

/** One row of `unrecognized_items` — a flagged item with its raw title. */
export class UnrecognizedItemModel {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 1 })
  importJobId!: number;

  @ApiProperty({
    example: 'PlayStaton 5',
    description:
      'Raw recognized title, stored even though it is never imported',
  })
  rawTitle!: string;

  @ApiPropertyOptional({ nullable: true, example: 'PS4' })
  rawPlatform!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 'no candidate passed acceptance',
  })
  reason!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Set when the user dismisses the item (null = open)',
    format: 'date-time',
  })
  dismissedAt!: Date | null;
}

/**
 * Job + ALL unrecognized items (dismissed included) — the full trace, which
 * must outlive dismissal (spec §4.2.5).
 */
export class ImportJobDetailModel {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({
    enum: IMPORT_JOB_STATUSES,
    example: 'needs_attention',
  })
  status!: string;

  @ApiPropertyOptional({ nullable: true, example: 12 })
  declaredCount!: number | null;

  @ApiProperty({ example: 11 })
  recognizedCount!: number;

  @ApiProperty({ example: 9 })
  importedCount!: number;

  @ApiProperty({ example: 2 })
  unrecognizedCount!: number;

  @ApiPropertyOptional({ nullable: true })
  errorMessage!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  completedAt!: Date | null;

  @ApiProperty({ type: [UnrecognizedItemModel] })
  unrecognizedItems!: UnrecognizedItemModel[];
}

export class ListImportJobsMetaModel {
  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 4 })
  total!: number;

  @ApiProperty({ example: 1 })
  totalPages!: number;
}

export class ListImportJobsResponseModel {
  @ApiProperty({ type: [ImportJobModel] })
  items!: ImportJobModel[];

  @ApiProperty({ type: ListImportJobsMetaModel })
  meta!: ListImportJobsMetaModel;
}
