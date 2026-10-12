import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ImportUploadJobModel {
  @ApiProperty({
    example: 42,
    description: 'ImportJob row id (poll GET /import-jobs/:id)',
  })
  id!: number;

  @ApiProperty({
    example: '42',
    description:
      'Queue job id; equals String(id), since the import_jobs row is the queue entry (ADR-005)',
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
