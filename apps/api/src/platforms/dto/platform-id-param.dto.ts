import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsUUID } from 'class-validator';

import { lowercaseId } from '../../common/lowercase-id';
import { UUID_V7_EXAMPLE } from '../../common/uuid-v7';

export class PlatformIdParamDto {
  @ApiProperty({ format: 'uuid', example: UUID_V7_EXAMPLE })
  @Transform(lowercaseId)
  @IsUUID('7')
  id!: string;
}
