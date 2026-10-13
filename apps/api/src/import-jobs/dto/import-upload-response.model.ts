import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { UUID_V7_EXAMPLE } from '../../common/uuid-v7';

export class ImportUploadJobModel {
  @ApiProperty({
    format: 'uuid',
    example: UUID_V7_EXAMPLE,
    description: 'ImportJob row id (poll GET /import-jobs/:id)',
  })
  id!: string;

  @ApiProperty({
    format: 'uuid',
    example: UUID_V7_EXAMPLE,
    description:
      'Queue job id; equals `id`, since the import_jobs row is the queue entry (ADR-005)',
  })
  jobId!: string;

  @ApiProperty({ example: 'queued' })
  status!: string;

  @ApiPropertyOptional({ nullable: true, example: 12 })
  declaredCount!: number | null;
}

export class StartImportUploadResponseModel {
  @ApiProperty({
    example: 'c1f0a4e2-...-9b3d',
    description: 'Batch id grouping every photo in this upload',
  })
  batchId!: string;

  @ApiProperty({ type: [ImportUploadJobModel] })
  jobs!: ImportUploadJobModel[];
}
