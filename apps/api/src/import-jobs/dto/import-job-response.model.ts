import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { UUID_V7_EXAMPLE } from '../../common/uuid-v7';
import { IMPORT_JOB_STATUSES } from './list-import-jobs-query.dto';

/** One row of `import_jobs` — a single import run (one uploaded photo). */
export class ImportJobModel {
  @ApiProperty({ format: 'uuid', example: UUID_V7_EXAMPLE })
  id!: string;

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

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Ephemeral stored-photo reference (filename under IMPORT_PHOTOS_DIR); internal — never served',
    example: '3f2a1c9e-...-b7.jpg',
  })
  photoRef!: string | null;

  @ApiProperty({ example: 11 })
  recognizedCount!: number;

  @ApiProperty({ example: 9 })
  importedCount!: number;

  @ApiProperty({
    example: 2,
    description:
      'Flagged items at completion (recognized titles with status unrecognized); never decremented by review',
  })
  unrecognizedCount!: number;

  @ApiProperty({
    example: 1,
    description:
      'Flagged items still awaiting review (not dismissed, picked or added by hand); counted live for every status',
  })
  openFlaggedCount!: number;

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

  @ApiPropertyOptional({
    nullable: true,
    description: 'Upload batch this run belongs to (groups one upload request)',
    example: 'c1f0a4e2-...-9b3d',
  })
  batchId!: string | null;

  @ApiProperty({
    description: 'Unresolved titles (recognized, neither imported nor flagged)',
    example: 1,
  })
  pendingCount!: number;

  @ApiProperty({
    description: 'status === needs_attention: a review trigger is still open',
    example: true,
  })
  needsAttention!: boolean;

  @ApiProperty({
    description: 'declaredCount differs from recognizedCount (ticket 4.8)',
    example: false,
  })
  declaredCountMismatch!: boolean;
}

/**
 * One tied catalog candidate offered for a flagged item (card 105). The
 * `coverUrl` is a same-origin signed preview link, never an external host.
 */
export class UnrecognizedItemCandidateModel {
  @ApiProperty({ enum: ['IGDB', 'MobyGames'], example: 'IGDB' })
  source!: 'IGDB' | 'MobyGames';

  @ApiProperty({ example: 18797 })
  externalId!: number;

  @ApiProperty({ example: 'Rise of Nations: Rise of Legends' })
  title!: string;

  @ApiPropertyOptional({
    nullable: true,
    example: 'rise-of-nations-rise-of-legends',
  })
  slug!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Same-origin signed preview URL; never an external host',
  })
  coverUrl!: string | null;

  @ApiProperty({ example: 0.95 })
  score!: number;
}

/** One row of `unrecognized_items` — a flagged item with its raw title. */
export class UnrecognizedItemModel {
  @ApiProperty({ format: 'uuid', example: UUID_V7_EXAMPLE })
  id!: string;

  @ApiProperty({ format: 'uuid', example: UUID_V7_EXAMPLE })
  importJobId!: string;

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

  @ApiProperty({
    type: [UnrecognizedItemCandidateModel],
    description:
      'Tied catalog candidates to choose from; empty unless several candidates matched equally well',
  })
  candidates!: UnrecognizedItemCandidateModel[];
}

/**
 * Job + ALL unrecognized items (dismissed included) — the full trace, which
 * must outlive dismissal (spec §4.2.5).
 */
export class ImportJobDetailModel {
  @ApiProperty({ format: 'uuid', example: UUID_V7_EXAMPLE })
  id!: string;

  @ApiProperty({
    enum: IMPORT_JOB_STATUSES,
    example: 'needs_attention',
  })
  status!: string;

  @ApiPropertyOptional({ nullable: true, example: 12 })
  declaredCount!: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Ephemeral stored-photo reference (filename under IMPORT_PHOTOS_DIR); internal — never served',
    example: '3f2a1c9e-...-b7.jpg',
  })
  photoRef!: string | null;

  @ApiProperty({ example: 11 })
  recognizedCount!: number;

  @ApiProperty({ example: 9 })
  importedCount!: number;

  @ApiProperty({ example: 2 })
  unrecognizedCount!: number;

  @ApiProperty({
    example: 1,
    description:
      'Flagged items still awaiting review (not dismissed, picked or added by hand); counted live for every status',
  })
  openFlaggedCount!: number;

  @ApiPropertyOptional({ nullable: true })
  errorMessage!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  completedAt!: Date | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Upload batch this run belongs to (groups one upload request)',
    example: 'c1f0a4e2-...-9b3d',
  })
  batchId!: string | null;

  @ApiProperty({
    description: 'Unresolved titles (recognized, neither imported nor flagged)',
    example: 1,
  })
  pendingCount!: number;

  @ApiProperty({
    description: 'status === needs_attention: a review trigger is still open',
    example: true,
  })
  needsAttention!: boolean;

  @ApiProperty({
    description: 'declaredCount differs from recognizedCount (ticket 4.8)',
    example: false,
  })
  declaredCountMismatch!: boolean;

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

/**
 * Aggregate progress for one upload batch (ticket 3.6): the X-of-Y view over
 * every photo in the request, derived from the durable job statuses.
 */
export class ImportBatchProgressModel {
  @ApiProperty({ example: 'c1f0a4e2-...-9b3d' })
  batchId!: string;

  @ApiProperty({ example: 5, description: 'Photos in the batch' })
  total!: number;

  @ApiProperty({ example: 1 })
  queued!: number;

  @ApiProperty({ example: 1 })
  processing!: number;

  @ApiProperty({ example: 2 })
  done!: number;

  @ApiProperty({ example: 1 })
  needsAttention!: number;

  @ApiProperty({ example: 0 })
  failed!: number;

  @ApiProperty({ example: 0 })
  dismissed!: number;

  @ApiProperty({
    example: 3,
    description: 'Photos that reached a terminal status',
  })
  completedCount!: number;

  @ApiProperty({
    example: 2,
    description: 'Photos still queued or processing (X of Y: Y - X)',
  })
  pendingCount!: number;

  @ApiProperty({
    example: false,
    description: 'Every photo reached a terminal status',
  })
  allCompleted!: boolean;

  @ApiProperty({
    description:
      'True when the photo-import queue is paused by a configuration error (ticket 3.10)',
    example: false,
  })
  paused!: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Why the queue is paused (the source config error)',
    example: 'IGDB rejected the credentials',
  })
  pauseReason!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    enum: ['llm', 'igdb'],
    description: 'Which integration to fix before resuming',
    example: 'igdb',
  })
  pauseSource!: string | null;
}

/** Global photo-import queue pause state (ticket 3.10). */
export class ImportQueueStateModel {
  @ApiProperty({ example: false })
  paused!: boolean;

  @ApiPropertyOptional({
    nullable: true,
    example: 'IGDB rejected the credentials',
  })
  reason!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    enum: ['llm', 'igdb'],
    example: 'igdb',
  })
  source!: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  pausedAt!: Date | null;
}
