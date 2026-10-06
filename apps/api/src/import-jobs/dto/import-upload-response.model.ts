import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ImportUploadJobModel {
  @ApiProperty({
    example: 42,
    description: 'ImportJob row id (poll GET /import-jobs/:id)',
  })
  id!: number;

  @ApiProperty({ example: '1', description: 'BullMQ job id' })
  jobId!: string;

  @ApiProperty({ example: 'queued' })
  status!: string;

  @ApiPropertyOptional({ nullable: true, example: 12 })
  declaredCount!: number | null;
}

export class StartImportUploadResponseModel {
  @ApiProperty({ type: [ImportUploadJobModel] })
  jobs!: ImportUploadJobModel[];
}
