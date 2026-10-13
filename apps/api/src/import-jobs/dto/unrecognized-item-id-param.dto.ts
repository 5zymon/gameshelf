import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsUUID } from 'class-validator';

import { lowercaseId } from '../../common/lowercase-id';
import { UUID_V7_EXAMPLE } from '../../common/uuid-v7';

/**
 * Route params for `PATCH /import-jobs/:id/unrecognized/:itemId`.
 *
 * One DTO carrying both params: the global pipe validates the whole
 * `req.params` object against a single metatype per `@Param()`, so two
 * separate param DTOs on the same route would each reject the other's
 * property (`forbidNonWhitelisted`).
 */
export class UnrecognizedItemIdParamDto {
  @ApiProperty({ format: 'uuid', example: UUID_V7_EXAMPLE })
  @Transform(lowercaseId)
  @IsUUID('7')
  id!: string;

  @ApiProperty({ format: 'uuid', example: UUID_V7_EXAMPLE })
  @Transform(lowercaseId)
  @IsUUID('7')
  itemId!: string;
}
