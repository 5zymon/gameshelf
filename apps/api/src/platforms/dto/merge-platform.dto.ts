import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

import { UUID_V7_EXAMPLE } from '../../common/uuid-v7';

/** Body of `POST /platforms/:id/merge`. */
export class MergePlatformDto {
  @ApiProperty({
    description: 'Surviving target platform id (UUIDv7)',
    format: 'uuid',
    example: UUID_V7_EXAMPLE,
  })
  @IsUUID('7')
  targetId!: string;
}
