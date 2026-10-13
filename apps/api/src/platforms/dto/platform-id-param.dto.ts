import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

import { UUID_V7_EXAMPLE } from '../../common/uuid-v7';

export class PlatformIdParamDto {
  @ApiProperty({ format: 'uuid', example: UUID_V7_EXAMPLE })
  @IsUUID('7')
  id!: string;
}
