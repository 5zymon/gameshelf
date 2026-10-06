import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class ImportBatchIdParamDto {
  @ApiProperty({ example: 'c1f0a4e2-...-9b3d' })
  @IsString()
  @MaxLength(64)
  batchId!: string;
}
